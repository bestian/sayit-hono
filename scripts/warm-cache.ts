/**
 * Pre-populate R2 cache by rendering pages via local wrangler dev
 * and uploading directly to the production R2 bucket.
 *
 * Phase 1: Render all pages locally → temp directory (fast, concurrent fetch)
 * Phase 2: Upload all files to R2 (concurrent wrangler CLI calls)
 *
 * Prerequisites: wrangler dev --remote must be running on localhost:8787
 *
 * Usage: npx tsx --tsconfig scripts/tsconfig.json scripts/warm-cache.ts [cache-version]
 */

import { exec } from 'node:child_process';
import { writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const LOCAL = 'http://localhost:8787';
const PROD_HOST = 'archive.tw';
const PROD_BUCKET = 'sayit-speech-cache';
const CACHE_VERSION = process.argv[2] || 'v5';
const RENDER_CONCURRENCY = 3;
const UPLOAD_CONCURRENCY = 5;

interface SpeechEntry {
	filename: string;
	isNested: boolean;
	nest_filenames: string[];
}

function buildCacheKey(pathname: string): string {
	return `${CACHE_VERSION}/${PROD_HOST}${pathname}`;
}

const tmpDir = path.resolve('/tmp', `warm-cache-${Date.now()}`);

// Phase 1: render all pages to disk
async function renderPage(pathname: string, index: number): Promise<boolean> {
	try {
		const resp = await fetch(`${LOCAL}${pathname}`);
		if (!resp.ok) return false;
		const html = await resp.text();
		// Encode pathname into filename: index + cache key (slashes → _)
		const cacheKey = buildCacheKey(pathname);
		const safeKey = cacheKey.replace(/\//g, '__');
		const meta = JSON.stringify({ cacheKey, file: `${index}.html` });
		await writeFile(path.join(tmpDir, `${index}.html`), html);
		await writeFile(path.join(tmpDir, `${index}.meta`), meta);
		return true;
	} catch {
		return false;
	}
}

// Phase 2: upload rendered files to R2
async function uploadFile(index: number): Promise<boolean> {
	try {
		const metaRaw = await import('node:fs').then(fs =>
			fs.readFileSync(path.join(tmpDir, `${index}.meta`), 'utf-8')
		);
		const { cacheKey } = JSON.parse(metaRaw);
		const filePath = path.join(tmpDir, `${index}.html`);
		await execAsync(
			`npx wrangler r2 object put "${PROD_BUCKET}/${cacheKey}" --file "${filePath}" --content-type "text/html; charset=utf-8" --remote`
		);
		return true;
	} catch {
		return false;
	}
}

async function processQueue<T>(items: T[], concurrency: number, fn: (item: T) => Promise<boolean>, label: string): Promise<{ done: number; errors: number }> {
	let done = 0;
	let errors = 0;
	const total = items.length;
	const queue = [...items];

	const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		while (queue.length > 0) {
			const item = queue.shift()!;
			const ok = await fn(item);
			done++;
			if (!ok) errors++;
			if (done % 100 === 0 || done === total) {
				console.log(`[warm-cache] ${label}: ${done}/${total} (${errors} errors)`);
			}
		}
	});

	await Promise.all(workers);
	return { done, errors };
}

async function main() {
	console.log(`[warm-cache] Cache version: ${CACHE_VERSION}`);
	console.log(`[warm-cache] Rendering via ${LOCAL}`);

	// Verify dev server
	try { await fetch(`${LOCAL}/`); } catch {
		console.error('[warm-cache] Cannot reach localhost:8787');
		process.exitCode = 1;
		return;
	}

	await mkdir(tmpDir, { recursive: true });

	const paths: string[] = ['/'];

	// Speeches
	console.log(`[warm-cache] Fetching speech index...`);
	const speechResp = await fetch(`${LOCAL}/api/speech_index.json`);
	if (!speechResp.ok) throw new Error(`speech_index: ${speechResp.status}`);
	const speeches = (await speechResp.json()) as SpeechEntry[];
	console.log(`[warm-cache] ${speeches.length} speeches`);

	paths.push('/speeches');
	for (const s of speeches) {
		paths.push(`/${encodeURIComponent(s.filename)}`);
		if (s.isNested && s.nest_filenames) {
			for (const n of s.nest_filenames) {
				paths.push(`/${encodeURIComponent(s.filename)}/${encodeURIComponent(n)}`);
			}
		}
	}

	// Speakers (skipped — warm separately if needed)
	// const speakerResp = await fetch(`${LOCAL}/api/speakers_index.json`);
	// if (speakerResp.ok) {
	// 	const speakers = (await speakerResp.json()) as Array<{ route_pathname: string }>;
	// 	for (const sp of speakers) paths.push(`/speaker${sp.route_pathname}`);
	// }

	console.log(`[warm-cache] Total: ${paths.length} pages\n`);

	// Phase 1: Render all pages
	console.log(`[warm-cache] === Phase 1: Render (concurrency ${RENDER_CONCURRENCY}) ===`);
	const indices = paths.map((_, i) => i);
	const renderResult = await processQueue(
		indices,
		RENDER_CONCURRENCY,
		(i) => renderPage(paths[i], i),
		'Render'
	);
	console.log(`[warm-cache] Rendered: ${renderResult.done - renderResult.errors} ok, ${renderResult.errors} errors\n`);

	// Phase 2: Upload to R2
	const successIndices = [];
	for (let i = 0; i < paths.length; i++) {
		try {
			await import('node:fs').then(fs => fs.accessSync(path.join(tmpDir, `${i}.html`)));
			successIndices.push(i);
		} catch {}
	}

	console.log(`[warm-cache] === Phase 2: Upload ${successIndices.length} files (concurrency ${UPLOAD_CONCURRENCY}) ===`);
	const uploadResult = await processQueue(
		successIndices,
		UPLOAD_CONCURRENCY,
		uploadFile,
		'Upload'
	);
	console.log(`[warm-cache] Uploaded: ${uploadResult.done - uploadResult.errors} ok, ${uploadResult.errors} errors\n`);

	// Cleanup
	await rm(tmpDir, { recursive: true, force: true });
	console.log(`[warm-cache] Done!`);
}

main().catch((err) => {
	console.error('[warm-cache] Fatal:', err);
	process.exitCode = 1;
});
