import type { SearchDocRecord } from './indexFormat';

/** Regex to detect speaker heading lines: 1-6 # followed by name ending in : or ： */
const speakerLineRegExp = /^(#{1,6})\s*(.+?)\s*[:：]\s*$/;
const MAX_OFFLINE_CONTENT_CHARS = 360;

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

function uniqueSpeakerNames(values: Array<string | null | undefined>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value?.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function summarizeSpeakers(values: Array<string | null | undefined>, limit = 3): string | null {
	const names = uniqueSpeakerNames(values);
	if (names.length === 0) return null;
	if (names.length <= limit) return names.join(', ');
	return `${names.slice(0, limit).join(', ')}, +${names.length - limit} more`;
}

function mergeContentBlocks(blocks: Array<{ content: string; speaker?: string | null }>): string {
	return blocks
		.map(({ content, speaker }) => {
			const normalizedContent = content.trim();
			if (!normalizedContent) return '';
			const normalizedSpeaker = speaker?.trim();
			return normalizedSpeaker ? `${normalizedSpeaker}: ${normalizedContent}` : normalizedContent;
		})
		.filter(Boolean)
		.join('\n\n')
		.trim();
}

function buildOfflineExcerpt(content: string, maxChars = MAX_OFFLINE_CONTENT_CHARS): string {
	const normalized = content.replace(/\s+/g, ' ').trim();
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, maxChars).trimEnd()}...`;
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
		const content = buildOfflineExcerpt(mergeContentBlocks(
			groupSections.map((section) => ({
				content: stripHtml(section.section_content || ''),
				speaker: section.name ?? null
			}))
		));
		if (!content) continue;

		docs.push({
			filename,
			pageUrl,
			title,
			content,
			sectionId: null,
			speaker: summarizeSpeakers(groupSections.map((section) => section.name))
		});
	}

	return docs;
}

/** Fallback: parse markdown into page-level docs (no real section IDs) */
export function docsFromMarkdown(markdown: string, pageUrl: string, filename: string): SearchDocRecord[] {
	const title = extractTitle(markdown);
	if (!title) return [];

	const lines = markdown.split('\n');
	let currentSpeaker: string | null = null;
	let currentLines: string[] = [];
	const blocks: Array<{ content: string; speaker: string | null }> = [];

	function flushSection() {
		const content = stripInlineMarkdown(currentLines.join('\n'));
		if (!content) return;
		blocks.push({
			content,
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

	if (blocks.length === 0) {
		const content = stripInlineMarkdown(markdown.replace(/^#\s+.*\n/, ''));
		if (content) {
			blocks.push({
				content,
				speaker: null
			});
		}
	}

	const mergedContent = buildOfflineExcerpt(mergeContentBlocks(blocks));
	if (!mergedContent) return [];

	return [{
		filename,
		pageUrl,
		title,
		content: mergedContent,
		sectionId: null,
		speaker: summarizeSpeakers(blocks.map((block) => block.speaker))
	}];
}
