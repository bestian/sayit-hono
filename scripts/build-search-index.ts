import { readdir, readFile } from 'node:fs/promises';
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

async function buildSearchIndex() {
	// pagefind is ESM-only; use dynamic import
	const pagefind = await import('pagefind');

	const transcriptDir = process.argv[2] || path.resolve('..', 'transcript');
	const outputDir = path.resolve('www', 'pagefind');
	const apiUrl = process.env.SAYIT_API_URL || 'https://sayit.archive.tw/api/speech_index.json';

	console.log(`[build-search] Reading .md files from: ${transcriptDir}`);
	console.log(`[build-search] Output: ${outputDir}`);

	// Build maps from transformFilename(mdFile) → mdFile for reverse lookup
	const entries = await readdir(transcriptDir);
	const mdFiles = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.'));
	const mdByTransformed = new Map<string, string>();
	// Also build a normalized map that strips hyphens between ASCII and CJK
	// to handle cases where DB filename differs from transform output
	const stripMixedHyphens = (s: string) => s.replace(/([a-z0-9])-(?=[^\x00-\x7f])/g, '$1').replace(/(?<=[^\x00-\x7f])-([a-z0-9])/g, '$1');
	const mdByNormalized = new Map<string, string>();
	for (const file of mdFiles) {
		const transformed = transformFilename(file);
		mdByTransformed.set(transformed, file);
		mdByNormalized.set(stripMixedHyphens(transformed), file);
	}

	console.log(`[build-search] Found ${mdFiles.length} markdown files`);

	// Fetch canonical filenames from production DB
	console.log(`[build-search] Fetching canonical filenames from ${apiUrl}`);
	const resp = await fetch(apiUrl);
	if (!resp.ok) throw new Error(`Failed to fetch speech index: HTTP ${resp.status}`);
	const dbEntries = (await resp.json()) as Array<{ filename: string; display_name: string }>;
	console.log(`[build-search] Got ${dbEntries.length} entries from DB`);

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

	for (const dbEntry of dbEntries) {
		const canonicalFilename = dbEntry.filename;

		// Find corresponding .md file: try exact match, then fuzzy (strip mixed hyphens)
		let mdFile = mdByTransformed.get(canonicalFilename)
			|| mdByNormalized.get(stripMixedHyphens(canonicalFilename));

		if (!mdFile) {
			noFile++;
			continue;
		}

		const filePath = path.join(transcriptDir, mdFile);
		const markdown = await readFile(filePath, 'utf-8');

		const title = extractTitle(markdown) || dbEntry.display_name;
		const date = extractDate(title);
		const speakers = extractSpeakers(markdown);
		const content = stripMarkdown(markdown);

		if (!content.trim()) {
			skipped++;
			continue;
		}

		// Use the canonical DB filename for the URL
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
	}

	// Also index .md files that aren't in the DB yet (new files not yet uploaded)
	const dbFilenames = new Set(dbEntries.map((e) => e.filename));
	const dbNormalized = new Set(dbEntries.map((e) => stripMixedHyphens(e.filename)));
	for (const file of mdFiles) {
		const derived = transformFilename(file);
		// Skip if already indexed via DB entry (exact or fuzzy match)
		if (dbFilenames.has(derived) || dbNormalized.has(stripMixedHyphens(derived))) continue;

		const filePath = path.join(transcriptDir, file);
		const markdown = await readFile(filePath, 'utf-8');
		const title = extractTitle(markdown);
		if (!title) { skipped++; continue; }
		const content = stripMarkdown(markdown);
		if (!content.trim()) { skipped++; continue; }

		const date = extractDate(title);
		const speakers = extractSpeakers(markdown);
		const url = `/${encodeURIComponent(derived)}`;

		await index.addCustomRecord({
			url, content, language: 'zh-tw',
			meta: { title, ...(date ? { date } : {}), ...(speakers.length > 0 ? { speaker: speakers.join(', ') } : {}) },
			filters: { ...(speakers.length > 0 ? { speaker: speakers } : {}) },
			sort: { ...(date ? { date } : {}) },
		});
		indexed++;
	}

	console.log(`[build-search] Indexed: ${indexed}, Skipped: ${skipped}, No .md file: ${noFile}`);

	// Write the index
	const { errors } = await index.writeFiles({
		outputPath: outputDir,
	});

	if (errors.length > 0) {
		console.error('[build-search] Errors:', errors);
		throw new Error(`Pagefind indexing produced ${errors.length} errors`);
	}

	console.log(`[build-search] Index written to ${outputDir}`);

	await pagefind.close();
}

buildSearchIndex().catch((err) => {
	console.error('[build-search] Fatal error:', err);
	process.exitCode = 1;
});
