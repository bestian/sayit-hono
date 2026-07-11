import { execSync } from 'node:child_process';
import { assertNotProd } from './lib/assert-not-prod';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { docsFromMarkdown, docsFromSections, extractDate, type ApiSection } from '../src/search/docBuilder';
import {
	SEARCH_INDEX_BASELINE_BR_KEY,
	SEARCH_INDEX_BASELINE_KEY,
	SEARCH_INDEX_MANIFEST_KEY,
	SEARCH_STATS_KEY,
	createEmptySearchOverlayManifest,
	packSearchDocs,
	unpackSearchDocs,
	type SearchDocRecord,
	type SearchIndexPayload,
} from '../src/search/indexFormat';

// Comma-separated override so non-prod runs (e.g. staging deploys) never
// write to the production bucket by accident — default preserves exact
// prior behavior for the real prod deploy path.
const R2_BUCKETS = (process.env.SEARCH_R2_BUCKETS ?? 'sayit-speech-cache,sayit-speech-cache-preview')
	.split(',')
	.map((b) => b.trim())
	.filter(Boolean);
const SEARCH_BUILD_FORMAT_VERSION = 2;
const SEARCH_BUILD_FORMAT_VERSION_KEY = '__search_build_format_version';

type SectionsDump = Record<string, ApiSection[]>;

interface Manifest {
	[filename: string]: number;
}

type SearchStats = {
	speeches?: number;
	speakers?: number;
	sections?: number;
};

/** Transform filename: lowercase, strip .md, replace full-width colon, max 50 chars */
function transformFilename(input: string): string {
	return input.toLowerCase().replace(/\.md$/, '').replace(/：/g, '-').slice(0, 50);
}

/** Fetch sections for a single speech from API with retries */
async function fetchSpeechSections(apiBase: string, filename: string): Promise<ApiSection[] | null> {
	const url = `${apiBase}/api/speech/${encodeURIComponent(filename)}`;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const resp = await fetch(url);
			if (resp.status === 404) return null;
			if (!resp.ok) {
				if (attempt < 2) {
					await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
					continue;
				}
				return null;
			}
			const data = (await resp.json()) as ApiSection[];
			return Array.isArray(data) && data.length > 0 ? data : null;
		} catch {
			if (attempt < 2) {
				await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
				continue;
			}
		}
	}
	return null;
}

/** Fetch sections for multiple speeches concurrently, updating dump in place */
async function fetchSections(apiBase: string, filenames: string[], dump: SectionsDump, concurrency = 20): Promise<void> {
	if (filenames.length === 0) return;
	let done = 0;
	const queue = [...filenames];

	const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		while (queue.length > 0) {
			const filename = queue.shift()!;
			const sections = await fetchSpeechSections(apiBase, filename);
			if (sections) {
				dump[filename] = sections;
			}
			done++;
			if (done % 200 === 0) {
				console.log(`[build-search]   ${done}/${filenames.length} fetched...`);
			}
		}
	});
	await Promise.all(workers);
}

function uploadFileToR2Buckets(key: string, filePath: string, contentType: string) {
	for (const bucket of R2_BUCKETS) assertNotProd(bucket);
	const MAX_RETRIES = 3;
	for (const bucket of R2_BUCKETS) {
		const cmd = `npx wrangler r2 object put ${bucket}/${key} --file "${filePath}" --content-type "${contentType}" --remote`;
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				execSync(cmd, { stdio: 'inherit' });
				break;
			} catch (err) {
				if (attempt < MAX_RETRIES) {
					const delay = attempt * 2;
					console.warn(`[build-search] R2 upload attempt ${attempt}/${MAX_RETRIES} failed for ${bucket}/${key}, retrying in ${delay}s...`);
					execSync(`sleep ${delay}`);
				} else {
					throw err;
				}
			}
		}
	}
}

async function removeIfExists(filePath: string) {
	try {
		await unlink(filePath);
	} catch {}
}

async function buildSearchIndex() {
	const transcriptDir = process.argv[2] || path.resolve('..', 'transcript');
	const outputPath = path.resolve('www', SEARCH_INDEX_BASELINE_KEY);
	const outputBrPath = path.resolve('www', SEARCH_INDEX_BASELINE_BR_KEY);
	const runtimeManifestPath = path.resolve('www', SEARCH_INDEX_MANIFEST_KEY);
	const statsPath = path.resolve('www', SEARCH_STATS_KEY);
	const buildManifestPath = path.resolve('scripts', 'search-build-manifest.json');
	const cacheIndexPath = path.resolve('scripts', 'search-index-cache.json');
	const dumpPath = path.resolve('scripts', 'sections-dump.json');
	const apiUrl = process.env.SAYIT_API_URL || 'https://archive.tw/api/speech_index.json';
	const apiBase = apiUrl.replace(/\/api\/speech_index\.json$/, '');
	const skipFetch = process.env.SKIP_FETCH === '1';
	const skipUpload = process.env.SKIP_UPLOAD === '1';
	const refreshDump = process.env.REFRESH_DUMP === '1';

	console.log(`[build-search] Reading .md files from: ${transcriptDir}`);

	const entries = await readdir(transcriptDir);
	const mdFiles = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.'));
	console.log(`[build-search] Found ${mdFiles.length} markdown files`);

	console.log(`[build-search] Fetching speech index from ${apiUrl}`);
	let dbEntries: Array<{ filename: string; display_name: string }> = [];
	try {
		const resp = await fetch(apiUrl);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		dbEntries = (await resp.json()) as Array<{ filename: string; display_name: string }>;
		console.log(`[build-search] Got ${dbEntries.length} entries from DB`);
	} catch (err) {
		console.warn(`[build-search] speech_index.json fetch failed (${err}), using filenames from markdown`);
	}

	const speakersApiUrl = apiUrl.replace('speech_index.json', 'speakers_index.json');
	const statsApiUrl = `${apiBase}/stats.json`;
	let speakersCount = 0;
	let statsFromApi: SearchStats | null = null;
	try {
		const speakersResp = await fetch(speakersApiUrl);
		if (speakersResp.ok) {
			const speakersData = (await speakersResp.json()) as Array<unknown>;
			speakersCount = speakersData.length;
		}
	} catch (err) {
		console.warn('[build-search] Failed to fetch speakers count', err);
	}
	try {
		const statsResp = await fetch(statsApiUrl);
		if (statsResp.ok) {
			statsFromApi = (await statsResp.json()) as SearchStats;
		}
	} catch (err) {
		console.warn('[build-search] Failed to fetch stats.json', err);
	}

	const stripMixedHyphens = (value: string) =>
		value.replace(/([a-z0-9])-(?=[^\x20-\x7f])/g, '$1').replace(/(?<=[^\x20-\x7f])-([a-z0-9])/g, '$1');
	const normalize = (value: string) => stripMixedHyphens(value).replace(/[、，。；：！？]/g, '');
	const canonicalByTransformed = new Map<string, string>();
	const canonicalByNormalized = new Map<string, string>();
	for (const entry of dbEntries) {
		canonicalByTransformed.set(entry.filename, entry.filename);
		canonicalByNormalized.set(normalize(entry.filename), entry.filename);
	}

	function resolveCanonical(mdFile: string): string {
		const derived = transformFilename(mdFile);
		return canonicalByTransformed.get(derived) || canonicalByNormalized.get(normalize(derived)) || derived;
	}

	let dump: SectionsDump = {};
	if (existsSync(dumpPath)) {
		console.log(`[build-search] Loading sections dump from: ${dumpPath}`);
		dump = JSON.parse(await readFile(dumpPath, 'utf-8')) as SectionsDump;
		console.log(`[build-search] Dump has ${Object.keys(dump).length} speeches`);
	} else {
		console.log(`[build-search] No local dump, fetching from ${apiBase}/sections-dump.json ...`);
		try {
			const resp = await fetch(`${apiBase}/sections-dump.json`);
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const text = await resp.text();
			await writeFile(dumpPath, text);
			dump = JSON.parse(text) as SectionsDump;
			console.log(`[build-search] Downloaded dump via HTTP (${Object.keys(dump).length} speeches)`);
		} catch (err) {
			console.log(`[build-search] HTTP dump download failed (${err}), will fetch from API`);
		}
	}

	let oldManifest: Manifest = {};
	let existingDocs: SearchDocRecord[] = [];
	if (existsSync(buildManifestPath) && existsSync(cacheIndexPath)) {
		try {
			oldManifest = JSON.parse(await readFile(buildManifestPath, 'utf-8')) as Manifest;
			if (oldManifest[SEARCH_BUILD_FORMAT_VERSION_KEY] !== SEARCH_BUILD_FORMAT_VERSION) {
				console.log('[build-search] Cached build format changed, forcing full rebuild');
				oldManifest = {};
			}
			const existingPayload = JSON.parse(await readFile(cacheIndexPath, 'utf-8')) as SearchIndexPayload;
			existingDocs = unpackSearchDocs(existingPayload);
			if (existingDocs.some((doc) => doc.sectionId != null)) {
				console.log('[build-search] Cached index is from the old section-level format, forcing full rebuild');
				oldManifest = {};
				existingDocs = [];
			}
			console.log(`[build-search] Loaded cached index (${existingDocs.length} docs)`);
		} catch {
			oldManifest = {};
			existingDocs = [];
		}
	}

	const newManifest: Manifest = {};
	const changedFiles: string[] = [];
	const currentFiles = new Set<string>();

	for (const file of mdFiles) {
		currentFiles.add(file);
		const fileStat = await stat(path.join(transcriptDir, file));
		const mtime = fileStat.mtimeMs;
		newManifest[file] = mtime;
		if (oldManifest[file] !== mtime) {
			changedFiles.push(file);
		}
	}
	newManifest[SEARCH_BUILD_FORMAT_VERSION_KEY] = SEARCH_BUILD_FORMAT_VERSION;

	const deletedFiles = Object.keys(oldManifest).filter((file) => !file.startsWith('__') && !currentFiles.has(file));
	const isIncremental = existingDocs.length > 0 && changedFiles.length + deletedFiles.length < mdFiles.length;

	if (isIncremental) {
		console.log(
			`[build-search] Incremental: ${changedFiles.length} changed, ${deletedFiles.length} deleted, ${mdFiles.length - changedFiles.length} unchanged`,
		);
	} else {
		console.log('[build-search] Full rebuild');
	}

	const filesToProcess = isIncremental ? changedFiles : mdFiles;
	const changedCanonicals = new Set(changedFiles.map(resolveCanonical));
	const canonicalsToFetch = new Set<string>();

	for (const file of filesToProcess) {
		const canonical = resolveCanonical(file);
		if (refreshDump || !dump[canonical] || (isIncremental && changedCanonicals.has(canonical))) {
			canonicalsToFetch.add(canonical);
		}
	}

	if (!isIncremental) {
		for (const entry of dbEntries) {
			if (refreshDump || !dump[entry.filename]) {
				canonicalsToFetch.add(entry.filename);
			}
		}
	}

	if (skipFetch && canonicalsToFetch.size > 0) {
		console.log(`[build-search] SKIP_FETCH=1, skipping ${canonicalsToFetch.size} API fetches (markdown fallback where needed)`);
	} else if (canonicalsToFetch.size > 0) {
		const fetchList = Array.from(canonicalsToFetch);
		console.log(`[build-search] Fetching sections for ${fetchList.length} speeches from API...`);
		await fetchSections(apiBase, fetchList, dump);
		await writeFile(dumpPath, JSON.stringify(dump));
		console.log(`[build-search] Sections dump saved locally (${Object.keys(dump).length} speeches)`);
		if (!skipUpload) {
			try {
				uploadFileToR2Buckets('sections-dump.json', dumpPath, 'application/json; charset=utf-8');
				console.log(`[build-search] Sections dump uploaded to R2 (${R2_BUCKETS.join(', ')})`);
			} catch (err) {
				console.warn('[build-search] R2 dump upload failed:', err);
			}
		}
	}

	const allDocs: SearchDocRecord[] = [];
	const allSpeakers = new Set<string>();

	if (isIncremental) {
		const changedFilenames = new Set([...changedFiles, ...deletedFiles].map(resolveCanonical));
		for (const doc of existingDocs) {
			if (!changedFilenames.has(doc.filename)) {
				allDocs.push(doc);
			}
		}
	}

	let indexed = 0;
	let skipped = 0;
	let fromDump = 0;
	let fromMarkdown = 0;

	for (const file of filesToProcess) {
		const canonical = resolveCanonical(file);
		const pageUrl = `/${encodeURIComponent(canonical)}`;
		const sections = dump[canonical];

		let docs: SearchDocRecord[];
		if (sections && sections.length > 0) {
			docs = docsFromSections(sections, pageUrl, canonical);
			for (const section of sections) {
				if (section.name) allSpeakers.add(section.name);
			}
			fromDump++;
		} else {
			const markdown = await readFile(path.join(transcriptDir, file), 'utf-8');
			docs = docsFromMarkdown(markdown, pageUrl, canonical);
			fromMarkdown++;
		}

		if (docs.length === 0) {
			skipped++;
			continue;
		}
		allDocs.push(...docs);
		indexed++;
	}

	if (!isIncremental) {
		const processedCanonicals = new Set(filesToProcess.map(resolveCanonical));
		for (const entry of dbEntries) {
			if (processedCanonicals.has(entry.filename)) continue;
			const sections = dump[entry.filename];
			if (!sections || sections.length === 0) continue;

			const docs = docsFromSections(sections, `/${encodeURIComponent(entry.filename)}`, entry.filename);
			for (const section of sections) {
				if (section.name) allSpeakers.add(section.name);
			}
			allDocs.push(...docs);
			indexed++;
			fromDump++;
		}
	}

	allDocs.sort((a, b) => extractDate(b.title).localeCompare(extractDate(a.title)));
	const sectionsCount = Number(statsFromApi?.sections ?? Object.values(dump).reduce((total, sections) => total + sections.length, 0));

	console.log(`[build-search] Processed: ${indexed} speeches (${fromDump} from dump, ${fromMarkdown} from markdown), Skipped: ${skipped}`);
	console.log(`[build-search] Total: ${allDocs.length} page docs from ${sectionsCount} sections`);

	await mkdir(path.dirname(outputPath), { recursive: true });
	await mkdir(path.dirname(cacheIndexPath), { recursive: true });

	const generatedAt = new Date().toISOString();
	const payload = packSearchDocs(allDocs, generatedAt);
	const jsonData = JSON.stringify(payload);
	const brotliData = brotliCompressSync(Buffer.from(jsonData));
	const baselineVersion = createHash('sha256').update(jsonData).digest('hex').slice(0, 16);
	const runtimeManifest = createEmptySearchOverlayManifest(baselineVersion, generatedAt);
	const stats = {
		speeches: Number(statsFromApi?.speeches ?? dbEntries.length),
		speakers: Number(statsFromApi?.speakers ?? speakersCount ?? allSpeakers.size),
		sections: sectionsCount,
	};

	await writeFile(outputPath, jsonData);
	await writeFile(outputBrPath, brotliData);
	await writeFile(cacheIndexPath, jsonData);
	await writeFile(buildManifestPath, JSON.stringify(newManifest));
	await writeFile(runtimeManifestPath, JSON.stringify(runtimeManifest));
	await writeFile(statsPath, JSON.stringify(stats));

	const sizeMB = (Buffer.byteLength(jsonData) / 1024 / 1024).toFixed(1);
	const brotliSizeMB = (brotliData.byteLength / 1024 / 1024).toFixed(1);
	console.log(`[build-search] Index written to ${outputPath} (${sizeMB} MB raw, ${brotliSizeMB} MB br)`);
	console.log(`[build-search] Stats written to ${statsPath}:`, stats);

	if (!skipUpload) {
		let uploadedToR2 = true;
		try {
			uploadFileToR2Buckets(SEARCH_INDEX_BASELINE_KEY, outputPath, 'application/json; charset=utf-8');
			uploadFileToR2Buckets(SEARCH_INDEX_BASELINE_BR_KEY, outputBrPath, 'application/octet-stream');
			uploadFileToR2Buckets(SEARCH_INDEX_MANIFEST_KEY, runtimeManifestPath, 'application/json; charset=utf-8');
			console.log(`[build-search] Uploaded search baseline + manifest to R2 (${R2_BUCKETS.join(', ')})`);
		} catch (err) {
			uploadedToR2 = false;
			console.error('[build-search] R2 upload failed:', err);
			console.log(`[build-search] Index kept at ${outputPath} for manual upload`);
		}

		try {
			uploadFileToR2Buckets(SEARCH_STATS_KEY, statsPath, 'application/json; charset=utf-8');
			console.log(`[build-search] stats.json uploaded to R2 (${R2_BUCKETS.join(', ')})`);
		} catch (err) {
			uploadedToR2 = false;
			console.error('[build-search] stats.json R2 upload failed:', err);
		}

		if (uploadedToR2) {
			await Promise.all([outputPath, outputBrPath, runtimeManifestPath, statsPath].map(removeIfExists));
			console.log('[build-search] Removed R2-served generated files from www/ before Wrangler asset upload');
		}
	}
}

buildSearchIndex().catch((err) => {
	console.error('[build-search] Fatal error:', err);
	process.exitCode = 1;
});
