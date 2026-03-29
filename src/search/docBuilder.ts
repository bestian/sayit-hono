import type { SearchDocRecord } from './indexFormat';

/** Regex to detect speaker heading lines: 1-6 # followed by name ending in : or ： */
const speakerLineRegExp = /^(#{1,6})\s*(.+?)\s*[:：]\s*$/;

export type ApiSection = {
	filename: string;
	nest_filename: string | null;
	section_id: number;
	section_content: string;
	display_name: string;
	name: string | null;
};

/** Extract display name from the first line (strip leading # ) */
function extractTitle(markdown: string): string {
	const firstLine = markdown.split('\n')[0]?.trim() ?? '';
	return firstLine.replace(/^#\s*/, '') || '';
}

/** Strip HTML tags and collapse whitespace */
export function stripHtml(html: string): string {
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

export function extractDate(displayName: string): string {
	const match = displayName.match(/^(\d{4}-\d{2}-\d{2})/);
	return match ? match[1] : '';
}

export function docsFromSections(
	sections: ApiSection[],
	baseUrl: string,
	filename = sections[0]?.filename || ''
): SearchDocRecord[] {
	const title = sections[0]?.display_name || '';
	const docs: SearchDocRecord[] = [];

	const groups = new Map<string, ApiSection[]>();
	for (const section of sections) {
		const key = section.nest_filename || '';
		const arr = groups.get(key) || [];
		arr.push(section);
		groups.set(key, arr);
	}

	for (const [nestFilename, groupSections] of groups) {
		const pageUrl = nestFilename
			? `${baseUrl}/${encodeURIComponent(nestFilename)}`
			: baseUrl;

		for (const section of groupSections) {
			const content = stripHtml(section.section_content || '').trim();
			if (!content) continue;

			docs.push({
				filename,
				pageUrl,
				title,
				content,
				sectionId: Number(section.section_id),
				speaker: section.name ?? null
			});
		}
	}

	return docs;
}

/** Fallback: parse markdown into section-level docs (no real section IDs) */
export function docsFromMarkdown(markdown: string, pageUrl: string, filename: string): SearchDocRecord[] {
	const title = extractTitle(markdown);
	if (!title) return [];

	const lines = markdown.split('\n');
	const docs: SearchDocRecord[] = [];
	let currentSpeaker: string | null = null;
	let currentLines: string[] = [];

	function flushSection() {
		const content = stripInlineMarkdown(currentLines.join('\n'));
		if (!content) return;
		docs.push({
			filename,
			pageUrl,
			title,
			content,
			sectionId: null,
			speaker: currentSpeaker
		});
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
			docs.push({
				filename,
				pageUrl,
				title,
				content,
				sectionId: null,
				speaker: null
			});
		}
	}

	return docs;
}
