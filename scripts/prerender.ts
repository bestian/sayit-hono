import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderHtml } from '../src/ssr/render';
import type { Component } from 'vue';
import { buildViews } from './build-views';

type PageSpec = {
	filename: string;
	title: string;
	styles?: string;
	component: Component;
	components: Record<string, Component>;
	aliases?: string[];
	props?: Record<string, unknown>;
};

function mergeStyles(...styles: Array<string | undefined>) {
	return styles.filter(Boolean).join('\n');
}

async function loadCompiledEntries() {
	await buildViews();
	const [views, components] = await Promise.all([
		import(pathToFileURL(path.resolve('src/.generated/views/index.ts')).href),
		import(pathToFileURL(path.resolve('src/.generated/components/index.ts')).href)
	]);

	return { views, components };
}

async function renderPage({ component, title, styles, filename, components, aliases, props }: PageSpec) {
	const html = await renderHtml(component, { title, styles, components, props });

	const outDir = path.resolve('www');
	await mkdir(outDir, { recursive: true });

	const targets = [filename, ...(aliases ?? [])];
	for (const target of targets) {
		const fullPath = path.join(outDir, target);
		await mkdir(path.dirname(fullPath), { recursive: true });
		await writeFile(fullPath, html, 'utf8');
	}
}

async function prerender() {
	const { views, components } = await loadCompiledEntries();
	const sharedComponents = { Navbar: components.Navbar, Footer: components.Footer };
	const sharedStyles = mergeStyles(components.NavbarStyles, components.FooterStyles);

	const speechIndexUrl =
		process.env.SPEECH_INDEX_URL ?? 'https://sayit-hono.audreyt.workers.dev/api/speech_index.json';
	let speechIndex: Array<{ filename: string; display_name: string }> = [];
	let speechSource = speechIndexUrl;

	try {
		const res = await fetch(speechIndexUrl);
		if (!res.ok) {
			throw new Error(`Unexpected status ${res.status}`);
		}
		speechIndex = await res.json();
	} catch (error) {
		console.warn(`[prerender] 無法取得 speech index，將輸出空列表：${String(error)}`);
		speechSource = `${speechIndexUrl} (fetch failed)`;
	}

	const pages: PageSpec[] = [
		{
			filename: 'index.html',
			title: 'Home',
			styles: mergeStyles(views.HomeViewStyles, sharedStyles),
			component: views.HomeView,
			components: sharedComponents
		},
		{
			filename: 'speeches.html',
			title: 'Speeches',
			styles: mergeStyles(views.SpeechesViewStyles, sharedStyles),
			component: views.SpeechesView,
			components: sharedComponents,
			props: { speeches: speechIndex, source: speechSource },
			aliases: ['speeches/index.html']
		}
	];

	await Promise.all(pages.map(renderPage));

	// 將 public 複製到 www，以支援預覽與部署靜態資源
	const publicDir = path.resolve('public');
	const outDir = path.resolve('www');
	// 保留與 public 相同的目錄結構（含根層 favicon/robots 與 static 目錄）
	await cp(publicDir, outDir, { recursive: true });
}

prerender().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

