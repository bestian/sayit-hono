// Local verification only (`bun run test:twin-chrome`). Not wired into `test` /
// `test:coverage`: CI has no macOS Chrome. Chrome on this desk hangs after
// --dump-dom; SIGKILL after 8s and read stdout. No CDP.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EN_HREF = '/2026-08-29-platform-originals-the-other-side-of-al';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_CANDIDATES = [
	process.env.CHROME_PATH,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium-browser',
	'/usr/bin/chromium',
].filter((path): path is string => Boolean(path));

const FOUC_CSS = `.lang-zh [lang="en"] { display: none; }
    .lang-en [lang="zh"] { display: none; }
    .lang-zh .record-copy[lang="en"],
    .lang-zh .record-copy [lang="en"] { display: revert !important; }
    .lang-zh .record-twin-button[lang="en"] { display: inline-flex !important; }`;

const FOUC_CSS_NO_TWIN = `.lang-zh [lang="en"] { display: none; }
    .lang-en [lang="zh"] { display: none; }
    .lang-zh .record-copy[lang="en"],
    .lang-zh .record-copy [lang="en"] { display: revert !important; }`;

const PROBE = `<script>
(function () {
  var root = document.documentElement;
  root.classList.remove('lang-en');
  root.classList.add('lang-zh');
  var twin = document.querySelector('a.record-twin-button');
  if (!twin) return;
  twin.setAttribute('data-computed-display', getComputedStyle(twin).display);
  twin.setAttribute('data-href', twin.getAttribute('href') || '');
})();
</script>`;

function chromePath(): string {
	const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
	if (!found) throw new Error('Chrome not found. Set CHROME_PATH to a Chromium binary.');
	return found;
}

function pageHtml(foucCss: string, designCss: string): string {
	return `<!DOCTYPE html>
<html class="no-touch">
<head>
  <style>${foucCss}</style>
  <style>${designCss}</style>
</head>
<body>
  <a href="${EN_HREF}" class="record-twin-button" lang="en" aria-label="Read English transcript">English</a>
  ${PROBE}
</body>
</html>`;
}

function withoutTwinExceptions(css: string): string {
	return css
		.replace(/\.lang-zh \.record-twin-button\[lang=['"]en['"]\][^{]*\{[^}]*\}/g, '')
		.replace(/\.lang-en \.record-twin-button\[lang=['"]zh(?:-Hant)?['"]\][^{]*\{[^}]*\}/g, '')
		.replace(/,\s*\{/g, '{')
		.replace(/\{\s*,/g, '{');
}

async function dumpDom(chrome: string, htmlPath: string, profileDir: string): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const child = spawn(
		chrome,
		[
			'--headless=new',
			'--no-sandbox',
			'--disable-gpu',
			'--disable-dev-shm-usage',
			'--no-first-run',
			'--no-default-browser-check',
			`--user-data-dir=${profileDir}`,
			'--dump-dom',
			`file://${htmlPath}`,
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	);
	const chunks: Buffer[] = [];
	child.stdout.on('data', (chunk: Buffer) => {
		chunks.push(chunk);
	});
	const timer = setTimeout(() => {
		child.kill('SIGKILL');
	}, 8000);
	child.on('error', (err) => {
		clearTimeout(timer);
		reject(err);
	});
	child.on('close', () => {
		clearTimeout(timer);
		resolve(Buffer.concat(chunks).toString('utf8'));
	});
	return promise;
}

function twinAttrs(dom: string): { display: string | null; href: string | null } {
	const tag = dom.match(/<a\b[^>]*\bclass="record-twin-button"[^>]*>/)?.[0];
	if (!tag) return { display: null, href: null };
	return {
		display: tag.match(/\bdata-computed-display="([^"]*)"/)?.[1] ?? null,
		href: tag.match(/\bdata-href="([^"]*)"/)?.[1] ?? null,
	};
}

async function main() {
	const chrome = chromePath();
	const designCss = await readFile(join(ROOT, 'src/styles/design.css'), 'utf8');
	const dir = await mkdtemp(join(tmpdir(), 'record-twin-'));
	try {
		const htmlPath = join(dir, 'page.html');
		await writeFile(htmlPath, pageHtml(FOUC_CSS, designCss));
		const visible = twinAttrs(await dumpDom(chrome, htmlPath, join(dir, 'profile-on')));
		if (visible.display !== 'inline-flex') {
			throw new Error(`expected computed display inline-flex under lang-zh, got ${JSON.stringify(visible.display)}`);
		}
		if (visible.href !== EN_HREF) {
			throw new Error(`expected data-href ${EN_HREF}, got ${JSON.stringify(visible.href)}`);
		}

		const hiddenPath = join(dir, 'hidden.html');
		await writeFile(hiddenPath, pageHtml(FOUC_CSS_NO_TWIN, withoutTwinExceptions(designCss)));
		const hidden = twinAttrs(await dumpDom(chrome, hiddenPath, join(dir, 'profile-off')));
		if (hidden.display !== 'none') {
			throw new Error(`expected hide rule to compute none without twin exception, got ${JSON.stringify(hidden.display)}`);
		}
		console.log(`✓ record-twin Chrome dump-dom: display=inline-flex href=${EN_HREF}`);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
