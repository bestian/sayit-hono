import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Regex to detect speaker heading lines: 1-6 # followed by name ending in : or ： */
const speakerLineRegExp = /^#{1,6}\s*(.+?)\s*[:：]\s*$/;

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

/** Extract unique speaker names from markdown */
function extractSpeakers(markdown: string): string[] {
	const speakers = new Set<string>();
	for (const line of markdown.split('\n')) {
		const match = speakerLineRegExp.exec(line.trim());
		if (match) {
			const name = match[1].replace(/\s*[:：]\s*$/, '').trim();
			if (name) speakers.add(name);
		}
	}
	return Array.from(speakers);
}

/** Strip markdown formatting for plain text content */
function stripMarkdown(markdown: string): string {
	return (
		markdown
			// Remove the title line
			.replace(/^#\s+.*\n/, '')
			// Remove speaker heading lines
			.replace(/^#{1,6}\s*.+[:：]\s*$/gm, '')
			// Remove quote markers
			.replace(/^>\s?/gm, '')
			// Remove markdown links, keep text
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			// Remove images
			.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
			// Remove inline code backticks
			.replace(/`([^`]+)`/g, '$1')
			// Remove bold/italic markers
			.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
			// Remove heading markers
			.replace(/^#{1,6}\s+/gm, '')
			// Collapse whitespace
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

/** Strip HTML tags and collapse whitespace */
function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Section shape from /api/speech/{filename} or sections dump */
type ApiSection = {
	filename: string;
	nest_filename: string | null;
	section_id: number;
	section_speaker: string | null;
	section_content: string;
	display_name: string;
	name: string | null;
};

/** Sections dump: { [filename]: ApiSection[] } */
type SectionsDump = Record<string, ApiSection[]>;

/** Load sections dump from file, or fetch from API */
async function loadSectionsDump(dumpPath: string | null, apiBase: string, dbEntries: Array<{ filename: string }>): Promise<SectionsDump> {
	if (dumpPath && existsSync(dumpPath)) {
		console.log(`[build-search] Loading sections from dump: ${dumpPath}`);
		const raw = await readFile(dumpPath, 'utf-8');
		return JSON.parse(raw) as SectionsDump;
	}

	// Fallback: fetch from API (slow, ~2s per speech)
	console.log(`[build-search] No sections dump found, fetching from API (${dbEntries.length} speeches, 10 concurrent)...`);
	const dump: SectionsDump = {};
	let done = 0;

	async function fetchOne(filename: string): Promise<void> {
		const url = `${apiBase}/api/speech/${encodeURIComponent(filename)}`;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const resp = await fetch(url);
				if (resp.status === 404) break;
				if (!resp.ok) {
					if (attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
					break;
				}
				const data = (await resp.json()) as ApiSection[];
				if (Array.isArray(data) && data.length > 0) dump[filename] = data;
				break;
			} catch {
				if (attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
			}
		}
		done++;
		if (done % 200 === 0) console.log(`[build-search]   ${done}/${dbEntries.length} fetched...`);
	}

	// 10 concurrent
	const queue = [...dbEntries];
	const workers = Array.from({ length: Math.min(10, queue.length) }, async () => {
		while (queue.length > 0) {
			const entry = queue.shift()!;
			await fetchOne(entry.filename);
		}
	});
	await Promise.all(workers);

	return dump;
}

async function buildSearchIndex() {
	// pagefind is ESM-only; use dynamic import
	const pagefind = await import('pagefind');

	const transcriptDir = process.argv[2] || path.resolve('..', 'transcript');
	const outputDir = path.resolve('www', 'pagefind');
	const apiUrl = process.env.SAYIT_API_URL || 'https://sayit.archive.tw/api/speech_index.json';
	const apiBase = apiUrl.replace(/\/api\/speech_index\.json$/, '');

	// Sections dump: env var, or default path in scripts/
	const sectionsDumpPath = process.env.SECTIONS_DUMP
		|| path.resolve(__dirname, 'sections-dump.json');

	console.log(`[build-search] Reading .md files from: ${transcriptDir}`);
	console.log(`[build-search] Output: ${outputDir}`);

	// Build maps from transformFilename(mdFile) → mdFile for reverse lookup
	const entries = await readdir(transcriptDir);
	const mdFiles = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.'));
	const mdByTransformed = new Map<string, string>();
	// Normalize for fuzzy matching: strip hyphens between ASCII/CJK and CJK punctuation
	const stripMixedHyphens = (s: string) => s.replace(/([a-z0-9])-(?=[^\x00-\x7f])/g, '$1').replace(/(?<=[^\x00-\x7f])-([a-z0-9])/g, '$1');
	const normalize = (s: string) => stripMixedHyphens(s).replace(/[、，。；：！？]/g, '');
	const mdByNormalized = new Map<string, string>();
	for (const file of mdFiles) {
		const transformed = transformFilename(file);
		mdByTransformed.set(transformed, file);
		mdByNormalized.set(normalize(transformed), file);
	}

	console.log(`[build-search] Found ${mdFiles.length} markdown files`);

	// Fetch canonical filenames from production DB
	console.log(`[build-search] Fetching canonical filenames from ${apiUrl}`);
	const resp = await fetch(apiUrl);
	if (!resp.ok) throw new Error(`Failed to fetch speech index: HTTP ${resp.status}`);
	const dbEntries = (await resp.json()) as Array<{ filename: string; display_name: string }>;
	console.log(`[build-search] Got ${dbEntries.length} entries from DB`);

	// Fetch speakers count from production API
	const speakersApiUrl = apiUrl.replace('speech_index.json', 'speakers_index.json');
	console.log(`[build-search] Fetching speakers from ${speakersApiUrl}`);
	let speakersCount = 0;
	try {
		const speakersResp = await fetch(speakersApiUrl);
		if (speakersResp.ok) {
			const speakersData = (await speakersResp.json()) as Array<unknown>;
			speakersCount = speakersData.length;
		}
	} catch (err) {
		console.warn('[build-search] Failed to fetch speakers, will count from markdown', err);
	}

	// Load section data from dump file or API
	const sectionsDump = await loadSectionsDump(sectionsDumpPath, apiBase, dbEntries);
	console.log(`[build-search] Sections data available for ${Object.keys(sectionsDump).length} speeches`);

	// Create Pagefind index
	const { index } = await pagefind.createIndex({
		forceLanguage: 'zh-tw',
	});

	if (!index) {
		throw new Error('Failed to create Pagefind index');
	}

	let indexed = 0;
	let skipped = 0;
	let noFile = 0;
	let sectionCount = 0;
	let docLevelFallback = 0;
	const allSpeakers = new Set<string>();

	for (const dbEntry of dbEntries) {
		const canonicalFilename = dbEntry.filename;
		const sections = sectionsDump[canonicalFilename];

		if (sections && sections.length > 0) {
			// Section-level indexing from dump/API data
			const title = sections[0].display_name || dbEntry.display_name;
			const date = extractDate(title);

			for (const section of sections) {
				const content = stripHtml(section.section_content || '');
				if (!content.trim()) { skipped++; continue; }

				const speakerName = section.name || null;
				if (speakerName) allSpeakers.add(speakerName);

				// Build URL with section anchor
				let url: string;
				if (section.nest_filename) {
					url = `/${encodeURIComponent(canonicalFilename)}/${encodeURIComponent(section.nest_filename)}#s${section.section_id}`;
				} else {
					url = `/${encodeURIComponent(canonicalFilename)}#s${section.section_id}`;
				}

				await index.addCustomRecord({
					url,
					content,
					language: 'zh-tw',
					meta: {
						title,
						...(date ? { date } : {}),
						...(speakerName ? { speaker: speakerName } : {}),
					},
					filters: {
						...(speakerName ? { speaker: [speakerName] } : {}),
					},
					sort: {
						...(date ? { date } : {}),
					},
				});

				indexed++;
				sectionCount++;
			}
			continue;
		}

		// Fallback: no section data, try document-level from markdown
		const mdFile = mdByTransformed.get(canonicalFilename)
			|| mdByNormalized.get(normalize(canonicalFilename));

		if (!mdFile) {
			noFile++;
			continue;
		}

		const filePath = path.join(transcriptDir, mdFile);
		const markdown = await readFile(filePath, 'utf-8');

		const title = extractTitle(markdown) || dbEntry.display_name;
		const date = extractDate(title);
		const speakers = extractSpeakers(markdown);
		for (const s of speakers) allSpeakers.add(s);
		const content = stripMarkdown(markdown);

		if (!content.trim()) {
			skipped++;
			continue;
		}

		const url = `/${encodeURIComponent(canonicalFilename)}`;

		await index.addCustomRecord({
			url,
			content,
			language: 'zh-tw',
			meta: {
				title,
				...(date ? { date } : {}),
				...(speakers.length > 0 ? { speaker: speakers.join(', ') } : {}),
			},
			filters: {
				...(speakers.length > 0 ? { speaker: speakers } : {}),
			},
			sort: {
				...(date ? { date } : {}),
			},
		});

		indexed++;
		docLevelFallback++;
	}

	// Also index .md files that aren't in the DB yet (new files not yet uploaded)
	const dbFilenames = new Set(dbEntries.map((e) => e.filename));
	const dbNormalized = new Set(dbEntries.map((e) => normalize(e.filename)));
	for (const file of mdFiles) {
		const derived = transformFilename(file);
		// Skip if already indexed via DB entry (exact or fuzzy match)
		if (dbFilenames.has(derived) || dbNormalized.has(normalize(derived))) continue;

		const filePath = path.join(transcriptDir, file);
		const markdown = await readFile(filePath, 'utf-8');
		const title = extractTitle(markdown);
		if (!title) { skipped++; continue; }
		const content = stripMarkdown(markdown);
		if (!content.trim()) { skipped++; continue; }

		const date = extractDate(title);
		const speakers = extractSpeakers(markdown);
		for (const s of speakers) allSpeakers.add(s);
		const url = `/${encodeURIComponent(derived)}`;

		await index.addCustomRecord({
			url, content, language: 'zh-tw',
			meta: { title, ...(date ? { date } : {}), ...(speakers.length > 0 ? { speaker: speakers.join(', ') } : {}) },
			filters: { ...(speakers.length > 0 ? { speaker: speakers } : {}) },
			sort: { ...(date ? { date } : {}) },
		});
		indexed++;
		docLevelFallback++;
	}

	console.log(`[build-search] Indexed: ${indexed} (${sectionCount} sections, ${docLevelFallback} doc-level fallback), Skipped: ${skipped}, No .md file: ${noFile}`);

	// Write the index
	const { errors } = await index.writeFiles({
		outputPath: outputDir,
	});

	if (errors.length > 0) {
		console.error('[build-search] Errors:', errors);
		throw new Error(`Pagefind indexing produced ${errors.length} errors`);
	}

	console.log(`[build-search] Index written to ${outputDir}`);

	// Write stats.json for the homepage
	const stats = {
		speeches: sectionCount,
		speakers: speakersCount || allSpeakers.size,
		sections: dbEntries.length,
	};
	const statsPath = path.resolve('www', 'stats.json');
	await writeFile(statsPath, JSON.stringify(stats));
	console.log(`[build-search] Stats written to ${statsPath}:`, stats);

	await pagefind.close();
}

buildSearchIndex().catch((err) => {
	console.error('[build-search] Fatal error:', err);
	process.exitCode = 1;
});
