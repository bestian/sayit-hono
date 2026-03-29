import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const R2_BUCKETS = ['sayit-speech-cache', 'sayit-speech-cache-preview'] as const;

/** Regex to detect speaker heading lines: 1-6 # followed by name ending in : or ： */
const speakerLineRegExp = /^(#{1,6})\s*(.+?)\s*[:：]\s*$/;

/** Extract display name from the first line (strip leading # ) */
function extractTitle(markdown: string): string {
	const firstLine = markdown.split('\n')[0]?.trim() ?? '';
	return firstLine.replace(/^#\s*/, '') || '';
}

/** Extract date from display name (YYYY-MM-DD prefix) */
function extractDate(displayName: string): string {
	const match = displayName.match(/^(\d{4}-\d{2}-\d{2})/);
	return match ? match[1] : '';
}

/** Transform filename: lowercase, strip .md, replace full-width colon, max 50 chars */
function transformFilename(input: string): string {
	return input.toLowerCase().replace(/\.md$/, '').replace(/：/g, '-').slice(0, 50);
}

/** Strip HTML tags and collapse whitespace */
function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Strip markdown formatting for plain text */
function stripInlineMarkdown(text: string): string {
	return text
		.replace(/^>\s?/gm, '')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

interface SearchDoc {
	t: string; // title
	c: string; // content
	u: string; // url
	d?: string; // date
	s?: string; // speaker
}

type ApiSection = {
	filename: string;
	nest_filename: string | null;
	section_id: number;
	section_content: string;
	display_name: string;
	name: string | null;
};

type SectionsDump = Record<string, ApiSection[]>;

/** Fetch sections for a single speech from API with retries */
async function fetchSpeechSections(apiBase: string, filename: string): Promise<ApiSection[] | null> {
	const url = `${apiBase}/api/speech/${encodeURIComponent(filename)}`;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const resp = await fetch(url);
			if (resp.status === 404) return null;
			if (!resp.ok) {
				if (attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
				return null;
			}
			const data = (await resp.json()) as ApiSection[];
			return Array.isArray(data) && data.length > 0 ? data : null;
		} catch {
			if (attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
		}
	}
	return null;
}

/** Fetch sections for multiple speeches concurrently, updating dump in place */
async function fetchMissingSections(
	apiBase: string,
	filenames: string[],
	dump: SectionsDump,
	concurrency = 20
): Promise<void> {
	if (filenames.length === 0) return;
	let done = 0;
	const queue = [...filenames];

	const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		while (queue.length > 0) {
			const filename = queue.shift()!;
			const sections = await fetchSpeechSections(apiBase, filename);
			if (sections) dump[filename] = sections;
			done++;
			if (done % 200 === 0) console.log(`[build-search]   ${done}/${filenames.length} fetched...`);
		}
	});
	await Promise.all(workers);
}

/** Build section-level search docs from API sections dump */
function docsFromSections(sections: ApiSection[], url: string): SearchDoc[] {
	const title = sections[0]?.display_name || '';
	const date = extractDate(title);
	const docs: SearchDoc[] = [];

	// Group by nest_filename
	const groups = new Map<string, ApiSection[]>();
	for (const section of sections) {
		const key = section.nest_filename || '';
		const arr = groups.get(key) || [];
		arr.push(section);
		groups.set(key, arr);
	}

	for (const [nestFilename, groupSections] of groups) {
		const groupUrl = nestFilename
			? `${url}/${encodeURIComponent(nestFilename)}`
			: url;

		for (const section of groupSections) {
			const content = stripHtml(section.section_content || '').trim();
			if (!content) continue;

			const doc: SearchDoc = {
				t: title,
				c: content,
				u: `${groupUrl}#s${section.section_id}`,
			};
			if (date) doc.d = date;
			if (section.name) doc.s = section.name;
			docs.push(doc);
		}
	}

	return docs;
}

/** Fallback: parse markdown into section-level docs (no real section IDs) */
function docsFromMarkdown(markdown: string, url: string): SearchDoc[] {
	const title = extractTitle(markdown);
	if (!title) return [];
	const date = extractDate(title);

	const lines = markdown.split('\n');
	const docs: SearchDoc[] = [];
	let currentSpeaker: string | null = null;
	let currentLines: string[] = [];

	function flushSection() {
		const content = stripInlineMarkdown(currentLines.join('\n'));
		if (!content) return;
		const doc: SearchDoc = { t: title, c: content, u: url };
		if (date) doc.d = date;
		if (currentSpeaker) doc.s = currentSpeaker;
		docs.push(doc);
	}

	for (let i = 0; i < lines.length; i++) {
		if (i === 0 && /^#\s/.test(lines[i])) continue;
		const match = speakerLineRegExp.exec(lines[i].trim());
		if (match) {
			flushSection();
			currentSpeaker = match[2].trim();
			currentLines = [];
		} else {
			currentLines.push(lines[i]);
		}
	}
	flushSection();

	if (docs.length === 0) {
		const content = stripInlineMarkdown(markdown.replace(/^#\s+.*\n/, ''));
		if (content) {
			const doc: SearchDoc = { t: title, c: content, u: url };
			if (date) doc.d = date;
			docs.push(doc);
		}
	}

	return docs;
}

interface Manifest {
	[filename: string]: number; // mtime ms
}

function uploadFileToR2Buckets(key: string, filePath: string, contentType: string) {
	for (const bucket of R2_BUCKETS) {
		execSync(
			`npx wrangler r2 object put ${bucket}/${key} --file "${filePath}" --content-type "${contentType}" --remote`,
			{ stdio: 'inherit' }
		);
	}
}

async function buildSearchIndex() {
	const transcriptDir = process.argv[2] || path.resolve('..', 'transcript');
	const outputPath = path.resolve('www', 'search-index.json');
	const manifestPath = path.resolve('www', 'search-index-manifest.json');
	const dumpPath = path.resolve('scripts', 'sections-dump.json');
	const apiUrl = process.env.SAYIT_API_URL || 'https://archive.tw/api/speech_index.json';
	const apiBase = apiUrl.replace(/\/api\/speech_index\.json$/, '');

	console.log(`[build-search] Reading .md files from: ${transcriptDir}`);

	const entries = await readdir(transcriptDir);
	const mdFiles = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.'));
	console.log(`[build-search] Found ${mdFiles.length} markdown files`);

	// Fetch canonical filenames from DB (single request)
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

	// Fetch speakers count
	const speakersApiUrl = apiUrl.replace('speech_index.json', 'speakers_index.json');
	let speakersCount = 0;
	try {
		const speakersResp = await fetch(speakersApiUrl);
		if (speakersResp.ok) {
			const speakersData = (await speakersResp.json()) as Array<unknown>;
			speakersCount = speakersData.length;
		}
	} catch (err) {
		console.warn('[build-search] Failed to fetch speakers count', err);
	}

	// Build canonical URL lookup
	const stripMixedHyphens = (s: string) => s.replace(/([a-z0-9])-(?=[^\x00-\x7f])/g, '$1').replace(/(?<=[^\x00-\x7f])-([a-z0-9])/g, '$1');
	const normalize = (s: string) => stripMixedHyphens(s).replace(/[、，。；：！？]/g, '');
	const canonicalByTransformed = new Map<string, string>();
	const canonicalByNormalized = new Map<string, string>();
	for (const entry of dbEntries) {
		canonicalByTransformed.set(entry.filename, entry.filename);
		canonicalByNormalized.set(normalize(entry.filename), entry.filename);
	}

	function resolveCanonical(mdFile: string): string {
		const derived = transformFilename(mdFile);
		return canonicalByTransformed.get(derived)
			|| canonicalByNormalized.get(normalize(derived))
			|| derived;
	}

	// Load sections dump: local file → R2 fallback
	let dump: SectionsDump = {};
	if (existsSync(dumpPath)) {
		console.log(`[build-search] Loading sections dump from: ${dumpPath}`);
		dump = JSON.parse(await readFile(dumpPath, 'utf-8'));
		console.log(`[build-search] Dump has ${Object.keys(dump).length} speeches`);
	} else {
		console.log(`[build-search] No local dump, fetching from ${apiBase}/sections-dump.json ...`);
		try {
			const resp = await fetch(`${apiBase}/sections-dump.json`);
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const text = await resp.text();
			await writeFile(dumpPath, text);
			dump = JSON.parse(text);
			console.log(`[build-search] Downloaded dump via HTTP (${Object.keys(dump).length} speeches)`);
		} catch (err) {
			console.log(`[build-search] HTTP dump download failed (${err}), will fetch from API`);
		}
	}

	// Load manifest for incremental builds
	let oldManifest: Manifest = {};
	let existingDocs: SearchDoc[] = [];
	if (existsSync(manifestPath) && existsSync(outputPath)) {
		try {
			oldManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
			existingDocs = JSON.parse(await readFile(outputPath, 'utf-8'));
			console.log(`[build-search] Loaded existing index (${existingDocs.length} docs)`);
		} catch {
			oldManifest = {};
			existingDocs = [];
		}
	}

	// Determine changed files by mtime
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

	const deletedFiles = Object.keys(oldManifest).filter(f => !currentFiles.has(f));
	const isIncremental = existingDocs.length > 0 && (changedFiles.length + deletedFiles.length) < mdFiles.length;

	if (isIncremental) {
		console.log(`[build-search] Incremental: ${changedFiles.length} changed, ${deletedFiles.length} deleted, ${mdFiles.length - changedFiles.length} unchanged`);
	} else {
		console.log(`[build-search] Full rebuild`);
	}

	// Fetch sections for speeches missing from dump
	const filesToProcess = isIncremental ? changedFiles : mdFiles;
	const canonicalsToFetch: string[] = [];
	for (const file of filesToProcess) {
		const canonical = resolveCanonical(file);
		if (!dump[canonical]) {
			canonicalsToFetch.push(canonical);
		}
	}

	// Also fetch any DB entries missing from dump
	if (!isIncremental) {
		for (const entry of dbEntries) {
			if (!dump[entry.filename] && !canonicalsToFetch.includes(entry.filename)) {
				canonicalsToFetch.push(entry.filename);
			}
		}
	}

	const skipFetch = process.env.SKIP_FETCH === '1';
	if (skipFetch && canonicalsToFetch.length > 0) {
		console.log(`[build-search] SKIP_FETCH=1, skipping ${canonicalsToFetch.length} API fetches (markdown fallback)`);
	} else if (canonicalsToFetch.length > 0) {
		console.log(`[build-search] Fetching sections for ${canonicalsToFetch.length} speeches from API...`);
		await fetchMissingSections(apiBase, canonicalsToFetch, dump);
		// Save updated dump locally and to R2
		await writeFile(dumpPath, JSON.stringify(dump));
		console.log(`[build-search] Sections dump saved locally (${Object.keys(dump).length} speeches)`);
		try {
			uploadFileToR2Buckets('sections-dump.json', dumpPath, 'application/json; charset=utf-8');
			console.log(`[build-search] Sections dump uploaded to R2 (prod + preview)`);
		} catch (err) {
			console.warn(`[build-search] R2 dump upload failed:`, err);
		}
	}

	// Build docs
	const allDocs: SearchDoc[] = [];
	const allSpeakers = new Set<string>();

	if (isIncremental) {
		// URLs to remove from existing index (changed/deleted files)
		const changedUrls = new Set<string>();
		for (const file of [...changedFiles, ...deletedFiles]) {
			changedUrls.add(`/${encodeURIComponent(resolveCanonical(file))}`);
		}
		// Keep unchanged docs
		for (const doc of existingDocs) {
			const baseUrl = doc.u.split('#')[0];
			if (!changedUrls.has(baseUrl)) {
				allDocs.push(doc);
				if (doc.s) allSpeakers.add(doc.s);
			}
		}
	}

	let indexed = 0;
	let skipped = 0;
	let fromDump = 0;
	let fromMarkdown = 0;

	for (const file of filesToProcess) {
		const canonical = resolveCanonical(file);
		const url = `/${encodeURIComponent(canonical)}`;
		const sections = dump[canonical];

		let docs: SearchDoc[];
		if (sections && sections.length > 0) {
			docs = docsFromSections(sections, url);
			fromDump++;
		} else {
			// Fallback to markdown parsing (no section IDs)
			const markdown = await readFile(path.join(transcriptDir, file), 'utf-8');
			docs = docsFromMarkdown(markdown, url);
			fromMarkdown++;
		}

		if (docs.length === 0) { skipped++; continue; }
		for (const doc of docs) {
			if (doc.s) allSpeakers.add(doc.s);
		}
		allDocs.push(...docs);
		indexed++;
	}

	// Also index DB entries that have dump data but no local .md file
	if (!isIncremental) {
		const processedCanonicals = new Set(filesToProcess.map(resolveCanonical));
		for (const entry of dbEntries) {
			if (processedCanonicals.has(entry.filename)) continue;
			const sections = dump[entry.filename];
			if (!sections || sections.length === 0) continue;

			const url = `/${encodeURIComponent(entry.filename)}`;
			const docs = docsFromSections(sections, url);
			for (const doc of docs) {
				if (doc.s) allSpeakers.add(doc.s);
			}
			allDocs.push(...docs);
			indexed++;
			fromDump++;
		}
	}

	// Sort by date descending
	allDocs.sort((a, b) => (b.d || '').localeCompare(a.d || ''));

	console.log(`[build-search] Processed: ${indexed} speeches (${fromDump} from dump, ${fromMarkdown} from markdown), Skipped: ${skipped}`);
	console.log(`[build-search] Total: ${allDocs.length} section docs`);

	await mkdir(path.dirname(outputPath), { recursive: true });
	const jsonData = JSON.stringify(allDocs);
	await writeFile(outputPath, jsonData);
	await writeFile(manifestPath, JSON.stringify(newManifest));
	const sizeMB = (Buffer.byteLength(jsonData) / 1024 / 1024).toFixed(1);
	console.log(`[build-search] Index written to ${outputPath} (${sizeMB} MB)`);

	// Upload to R2 via wrangler, then remove from www/ (too large for static assets)
	try {
		uploadFileToR2Buckets('search-index.json', outputPath, 'application/json; charset=utf-8');
		console.log(`[build-search] Uploaded to R2 (prod + preview)`);
	} catch (err) {
		console.error(`[build-search] R2 upload failed:`, err);
		console.log(`[build-search] Index kept at ${outputPath} for manual upload`);
	}
	// Remove from www/ so wrangler deploy doesn't hit the 25 MB asset limit
	const { unlink } = await import('node:fs/promises');
	try { await unlink(outputPath); } catch {};

	// Write stats.json
	const stats = {
		speeches: dbEntries.length,
		speakers: speakersCount || allSpeakers.size,
		sections: allDocs.length,
	};
	const statsPath = path.resolve('www', 'stats.json');
	const statsJson = JSON.stringify(stats);
	await writeFile(statsPath, statsJson);
	console.log(`[build-search] Stats written to ${statsPath}:`, stats);

	// Upload stats.json to R2 (served via Worker route, not ASSETS)
	try {
		uploadFileToR2Buckets('stats.json', statsPath, 'application/json; charset=utf-8');
		console.log(`[build-search] stats.json uploaded to R2 (prod + preview)`);
	} catch (err) {
		console.error(`[build-search] stats.json R2 upload failed:`, err);
	}
}

buildSearchIndex().catch((err) => {
	console.error('[build-search] Fatal error:', err);
	process.exitCode = 1;
});
