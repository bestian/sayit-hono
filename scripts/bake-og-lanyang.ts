#!/usr/bin/env bun
/**
 * Bake Lanyang OG PNGs on a licensed device (Mac/dgx with ~/Library/Fonts jf cuts).
 * Uploads pixels only to R2 — Worker serves cache; no font bytes on Cloudflare.
 *
 * Usage:
 *   bun run scripts/bake-og-lanyang.ts --git <beforeSha> <afterSha>   # transcript push diff
 *   bun run scripts/bake-og-lanyang.ts --filename <db-filename>
 *   bun run scripts/bake-og-lanyang.ts --dry-run --git ...
 *
 * Env: CLOUDFLARE_* for wrangler r2 put --remote (optional with --out-dir only)
 */
import { execFileSync, execSync } from 'node:child_process';
import { assertNotProd } from './lib/assert-not-prod';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_KEY_VERSION as BUILT_CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import { resolveCacheKeyVersion } from './lib/archive-cache-version';
import { lanyangFontsInstalled, renderLanyangSpeechPng, slugFromMarkdownPath } from './og-lanyang-lib';

const PROD_BUCKET = process.env.OG_R2_BUCKET ?? 'sayit-speech-cache';
const API_BASE = process.env.ARCHIVE_API_BASE ?? 'https://archive.tw';

type SpeechRow = { filename: string; display_name: string };

function parseArgs(argv: string[]): {
	mode: 'git' | 'filename' | 'all' | 'help';
	before?: string;
	after?: string;
	filenames: string[];
	dryRun: boolean;
	outDir: string | null;
	transcriptRoot: string;
	startAfter: string | null;
} {
	const dryRun = argv.includes('--dry-run');
	const outIdx = argv.indexOf('--out-dir');
	const outDir = outIdx >= 0 ? (argv[outIdx + 1] ?? null) : null;
	const trIdx = argv.indexOf('--transcript-root');
	const transcriptRoot = trIdx >= 0 ? (argv[trIdx + 1] ?? process.cwd()) : process.cwd();
	const saIdx = argv.indexOf('--start-after');
	const startAfter = saIdx >= 0 ? (argv[saIdx + 1] ?? null) : null;

	if (argv.includes('--all')) {
		return { mode: 'all', filenames: [], dryRun, outDir, transcriptRoot, startAfter };
	}

	const gitIdx = argv.indexOf('--git');
	if (gitIdx >= 0) {
		return {
			mode: 'git',
			before: argv[gitIdx + 1],
			after: argv[gitIdx + 2],
			filenames: [],
			dryRun,
			outDir,
			transcriptRoot,
			startAfter,
		};
	}

	const fnIdx = argv.indexOf('--filename');
	if (fnIdx >= 0) {
		const filenames = argv.slice(fnIdx + 1).filter((a) => !a.startsWith('--'));
		return { mode: 'filename', filenames, dryRun, outDir, transcriptRoot, startAfter };
	}

	return { mode: 'help', filenames: [], dryRun, outDir, transcriptRoot, startAfter: null };
}

function gitDiffMdPaths(before: string, after: string, root: string): string[] {
	const out = execFileSync('git', ['diff', '--name-status', '-z', before, after, '--', '*.md', '.alternates'], {
		cwd: root,
		encoding: 'utf-8',
	});
	const tokens = out.split('\0').filter(Boolean);
	const paths: string[] = [];
	for (let i = 0; i + 1 < tokens.length; i += 2) {
		const status = tokens[i];
		let rel = tokens[i + 1];
		if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1);
		if (!rel.endsWith('.md') || rel.includes('/')) continue;
		if (status.startsWith('D')) continue;
		paths.push(rel);
	}
	return [...new Set(paths)];
}

async function fetchSpeechIndex(): Promise<SpeechRow[]> {
	const res = await fetch(`${API_BASE}/api/speech_index.json`);
	if (!res.ok) throw new Error(`speech_index ${res.status}`);
	const rows = (await res.json()) as SpeechRow[];
	return rows;
}

function resolveDbFilename(mdPath: string, index: SpeechRow[]): string | null {
	const slug = slugFromMarkdownPath(mdPath);
	const exact = index.find((r) => r.filename === slug);
	if (exact) return exact.filename;
	const stem = mdPath.replace(/\.md$/i, '').toLowerCase().replace(/：/g, '-');
	const loose = index.find((r) => r.filename.startsWith(stem.slice(0, 50)));
	return loose?.filename ?? null;
}

async function fetchSpeakers(filename: string): Promise<string[]> {
	const encoded = encodeURIComponent(filename);
	const res = await fetch(`${API_BASE}/api/speech/${encoded}`);
	if (!res.ok) return [];
	type SpeakerRow = { section_id?: number; name?: string | null; speaker_name?: string | null };
	const data = (await res.json()) as Array<SpeakerRow> | { sections?: Array<SpeakerRow> };

	const rows: SpeakerRow[] = Array.isArray(data) ? data : (data.sections ?? []);
	const ordered: { section_id: number; name: string }[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		const name = (row.name ?? row.speaker_name)?.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		ordered.push({ section_id: Number(row.section_id ?? 0), name });
	}
	ordered.sort((a, b) => a.section_id - b.section_id);
	return ordered.map((r) => r.name).slice(0, 5);
}

function uploadR2(cacheKey: string, filePath: string, dryRun: boolean): void {
	if (dryRun) {
		console.log(`[dry-run] r2 put ${PROD_BUCKET}/${cacheKey} <= ${filePath}`);
		return;
	}
	assertNotProd(PROD_BUCKET);
	execSync(`npx wrangler r2 object put "${PROD_BUCKET}/${cacheKey}" --file "${filePath}" --content-type image/png --remote`, {
		stdio: 'inherit',
	});
}

async function bakeOne(
	filename: string,
	index: SpeechRow[],
	cacheKeyVersion: string,
	opts: { dryRun: boolean; outDir: string | null },
): Promise<boolean> {
	const meta = index.find((r) => r.filename === filename);
	if (!meta) {
		console.warn(`skip (not in speech_index): ${filename}`);
		return false;
	}

	const speakers = await fetchSpeakers(filename);
	const png = await renderLanyangSpeechPng(filename, meta.display_name, speakers);
	const cacheKey = `${cacheKeyVersion}/og/${filename}.png`;

	const tmp = join(import.meta.dirname, '..', '.og-bake-tmp');
	mkdirSync(tmp, { recursive: true });
	const localPath = join(tmp, `${filename}.${process.pid}.png`);
	writeFileSync(localPath, png);

	if (opts.outDir) {
		const dest = join(opts.outDir, `${filename}.png`);
		writeFileSync(dest, png);
		console.log(`wrote ${dest}`);
	}

	try {
		uploadR2(cacheKey, localPath, opts.dryRun);
	} finally {
		try {
			rmSync(localPath, { force: true });
		} catch {
			// ignore
		}
	}
	console.log(`baked ${filename} → ${cacheKey} (${png.length} bytes, speakers=${speakers.join('|') || '—'})`);
	return true;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (args.mode === 'help' || (args.mode === 'git' && (!args.before || !args.after))) {
		console.log(`Usage:
  bun run scripts/bake-og-lanyang.ts --filename <speech-filename> [...]
  bun run scripts/bake-og-lanyang.ts --git <before> <after> [--transcript-root DIR]
  bun run scripts/bake-og-lanyang.ts --all [--start-after <filename>]
  --dry-run  --out-dir DIR

Speech OG only: R2 key \${CACHE_KEY_VERSION}/og/<filename>.png (not /og/speech/*.png).
Default CACHE_KEY_VERSION: live GET https://archive.tw/version (override with env CACHE_KEY_VERSION).
Committed src/cacheKeyVersion.ts is fallback only when /version is unreachable.`);
		process.exit(args.mode === 'help' ? 0 : 1);
	}

	if (!lanyangFontsInstalled()) {
		console.warn('[lanyang-og] jf Lanyang fonts not under ~/Library/Fonts — noop (Worker Noto fallback until licensed bake)');
		process.exit(0);
	}

	const cacheKeyVersion = await resolveCacheKeyVersion(BUILT_CACHE_KEY_VERSION);
	console.log(`CACHE_KEY_VERSION=${cacheKeyVersion}`);

	const index = await fetchSpeechIndex();
	let filenames: string[] = [];

	if (args.mode === 'all') {
		filenames = index.map((r) => r.filename);
		if (args.startAfter) {
			const i = filenames.indexOf(args.startAfter);
			if (i < 0) {
				console.error(`--start-after not in speech_index: ${args.startAfter}`);
				process.exit(1);
			}
			filenames = filenames.slice(i + 1);
			console.log(`--all resume: after ${args.startAfter} → ${filenames.length} remaining`);
		} else {
			console.log(`--all: ${filenames.length} speech OG images (skipping /og/speech/*)`);
		}
	} else if (args.mode === 'git') {
		const mdPaths = gitDiffMdPaths(args.before!, args.after!, args.transcriptRoot);
		for (const md of mdPaths) {
			const db = resolveDbFilename(md, index);
			if (db) filenames.push(db);
		}
		console.log(`git diff md → ${mdPaths.length} file(s) → ${filenames.length} speech slug(s)`);
	} else {
		filenames = args.filenames;
	}

	if (filenames.length === 0) {
		console.log('nothing to bake');
		return;
	}

	let ok = 0;
	for (const fn of filenames) {
		try {
			if (await bakeOne(fn, index, cacheKeyVersion, { dryRun: args.dryRun, outDir: args.outDir })) ok++;
		} catch (err) {
			console.error(`failed ${fn}:`, err);
		}
	}

	// Per-file temp cleanup in bakeOne; do not rmSync whole .og-bake-tmp mid --all (resume-friendly).

	console.log(`done: ${ok}/${filenames.length}`);
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
