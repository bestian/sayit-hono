import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';
import { getAnContentAsString } from './an';
import { isNumericAnKey } from './an';

const MD_FILE_EXTENSION = '.md';

/** 需完整保留「成對標籤 + 內容」 */
const PRESERVE_PAIRED_TAGS = ['iframe', 'video', 'audio', 'object', 'svg', 'a'];
/** 需保留「單一標籤」 */
const PRESERVE_VOID_TAGS = ['img', 'br'];

function hasMeaningfulSpeechContent(fragment: string): boolean {
	const trimmed = fragment.trim();
	if (!trimmed) return false;

	// 即使沒有純文字，只要是需要保留的 HTML 區塊（如 svg）也視為有效段落
	if (/<(?:svg|iframe|video|audio|object|a|img|br)\b/i.test(trimmed)) {
		return true;
	}

	const plainText = trimmed
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;|&#160;/gi, ' ')
		.replace(/\s+/g, '')
		.trim();
	return plainText.length > 0;
}

function extractSpeechParagraphs(inner: string): string[] {
	const paragraphs: string[] = [];
	const pBlockRegex = /<p\b[^>]*>[\s\S]*?<\/p\s*>/gi;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pBlockRegex.exec(inner)) !== null) {
		const before = inner.slice(lastIndex, match.index).trim();
		if (hasMeaningfulSpeechContent(before)) {
			paragraphs.push(before);
		}

		const pContent = match[0]
			.replace(/^<p\b[^>]*>/i, '')
			.replace(/<\/p\s*>$/i, '')
			.trim();
		if (hasMeaningfulSpeechContent(pContent)) {
			paragraphs.push(pContent);
		}

		lastIndex = pBlockRegex.lastIndex;
	}

	const tail = inner.slice(lastIndex).trim();
	if (hasMeaningfulSpeechContent(tail)) {
		paragraphs.push(tail);
	}

	// 若完全沒有匹配到 <p>，仍保留整段（例如純 <svg>...</svg>）
	if (paragraphs.length === 0 && hasMeaningfulSpeechContent(inner)) {
		paragraphs.push(inner.trim());
	}

	return paragraphs;
}

function preserveSvgBlocks(html: string, restores: Map<string, string>, counterRef: { value: number }): string {
	let result = html;
	while (true) {
		const openMatch = /<svg\b[^>]*>/i.exec(result);
		if (!openMatch || openMatch.index === undefined) break;

		const start = openMatch.index;
		const openEnd = start + openMatch[0].length;
		const closeMatch = /<\/svg\s*>/i.exec(result.slice(openEnd));

		let end = result.length;
		if (closeMatch && closeMatch.index !== undefined) {
			end = openEnd + closeMatch.index + closeMatch[0].length;
		}

		const block = result.slice(start, end);
		const key = `\u0000MD_PRESERVE_${counterRef.value++}\u0000`;
		restores.set(key, block);
		result = `${result.slice(0, start)}${key}${result.slice(end)}`;
	}
	return result;
}

function preserveSpecialTags(html: string): { result: string; restores: Map<string, string> } {
	const restores = new Map<string, string>();
	const counterRef = { value: 0 };
	let result = preserveSvgBlocks(html, restores, counterRef);

	for (const tag of PRESERVE_PAIRED_TAGS) {
		if (tag === 'svg') continue;

		// 成對標籤：如 <svg>...</svg>、<a>...</a>
		const withContent = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
		result = result.replace(withContent, (match) => {
			const key = `\u0000MD_PRESERVE_${counterRef.value++}\u0000`;
			restores.set(key, match);
			return key;
		});
	}

	for (const tag of PRESERVE_VOID_TAGS) {
		// void/self-closing：同時支援 <br> / <br/>、<img ...> / <img .../>
		const voidTag = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
		result = result.replace(voidTag, (match) => {
			const key = `\u0000MD_PRESERVE_${counterRef.value++}\u0000`;
			restores.set(key, match);
			return key;
		});
	}

	return { result, restores };
}

function restoreSpecialTags(text: string, restores: Map<string, string>): string {
	let result = text;
	for (const [key, value] of restores) {
		result = result.split(key).join(value);
	}
	return result;
}

/** 純 JS 實作：Akoma Ntoso .an 轉 Markdown（相容 sayit/md2an 格式） */
function an2md(anXml: string): string {
	const headingMatch = anXml.match(/<heading>([\s\S]*?)<\/heading>/);
	const heading = headingMatch
		? (() => {
				const { result: preserved, restores } = preserveSpecialTags(headingMatch[1]);
				let out = preserved
					.replace(/<[^>]+>/g, '')
					.replace(/&amp;/g, '&')
					.replace(/&lt;/g, '<')
					.replace(/&gt;/g, '>')
					.replace(/&quot;/g, '"')
					.replace(/&apos;/g, "'")
					.trim();
				return restoreSpecialTags(out, restores);
			})()
		: '';

	const tlcPersons = new Map<string, string>();
	const personRegex = /<TLCPerson[^>]*\/>/g;
	let pm: RegExpExecArray | null;
	while ((pm = personRegex.exec(anXml)) !== null) {
		const tag = pm[0];
		const idMatch = tag.match(/\bid="([^"]*)"/);
		const showMatch = tag.match(/\bshowAs="([^"]*)"/);
		if (idMatch && showMatch) {
			tlcPersons.set(idMatch[1], showMatch[1]);
		}
	}

	const speechRegex = /<speech\s[^>]*by="#([^"]*)"[^>]*>([\s\S]*?)<\/speech>/gi;
	const blocks: Array<{ showAs: string; content: string }> = [];
	let sm: RegExpExecArray | null;
	while ((sm = speechRegex.exec(anXml)) !== null) {
		const speakerId = sm[1];
		const inner = sm[2];
		const showAs = tlcPersons.get(speakerId) ?? speakerId;
		const paragraphs = extractSpeechParagraphs(inner);
		const content = paragraphs
			.map((p) => {
				const { result: preserved, restores } = preserveSpecialTags(p);
				let out = preserved
					.replace(/<br\s*\/?>/gi, '\n')
					.replace(/<[^>]+>/g, '')
					.replace(/&amp;/g, '&')
					.replace(/&lt;/g, '<')
					.replace(/&gt;/g, '>')
					.replace(/&quot;/g, '"')
					.replace(/&apos;/g, "'")
					.trim();
				return restoreSpecialTags(out, restores);
			})
			.filter(Boolean)
			.join('\n\n');
		if (content) {
			blocks.push({ showAs, content });
		}
	}

	// 合併連續相同 Speaker，只保留一次 ###
	const merged: string[] = [];
	let prevShowAs: string | null = null;
	for (const { showAs, content } of blocks) {
		if (showAs === prevShowAs) {
			merged.push(content);
		} else {
			merged.push(`### ${showAs}: \n\n${content}`);
			prevShowAs = showAs;
		}
	}

	const lines: string[] = [];
	if (heading) {
		lines.push(`# ${heading}\n`);
	}
	lines.push(merged.join('\n\n'));
	return lines.join('\n');
}

/** 提供 .md 檔案，依 objectKey 取得 .an 後轉成 markdown
 * - 629603.md：單一 section（不快取）
 * - 2025-11-08-解學習監管.md：完整演講（快取於 md/filename）
 */
export async function serveMdByKey(c: Context<ApiEnv>, objectKey: string) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	if (!objectKey || !objectKey.endsWith(MD_FILE_EXTENSION)) {
		return c.text('Markdown not found', 404, corsHeaders);
	}

	const anKey = objectKey.slice(0, -MD_FILE_EXTENSION.length) + '.an';

	const anContent = await getAnContentAsString(c, anKey);
	if (!anContent) {
		return c.text('Markdown not found', 404, corsHeaders);
	}

	const mdContent = an2md(anContent);

	const headers = new Headers(corsHeaders);
	headers.set('Content-Type', 'text/markdown; charset=utf-8');
	headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
	headers.set('Pragma', 'no-cache');
	headers.set('Expires', '0');

	return new Response(mdContent, { status: 200, headers });
}
