import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';
import { getAnContentAsString } from './an';

const MD_FILE_EXTENSION = '.md';

/** 需完整保留的 HTML 標籤（含內容） */
const PRESERVE_TAGS = ['iframe', 'video', 'audio', 'object'];

function preserveSpecialTags(html: string): { result: string; restores: Map<string, string> } {
	const restores = new Map<string, string>();
	let counter = 0;
	let result = html;
	for (const tag of PRESERVE_TAGS) {
		// 有內容的標籤，如 <iframe>...</iframe>
		const withContent = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
		result = result.replace(withContent, (match) => {
			const key = `\u0000MD_PRESERVE_${counter++}\u0000`;
			restores.set(key, match);
			return key;
		});
		// 自閉合標籤，如 <iframe ... />
		const selfClose = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
		result = result.replace(selfClose, (match) => {
			const key = `\u0000MD_PRESERVE_${counter++}\u0000`;
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
		const paragraphs = inner
			.split(/<p[^>]*>/i)
			.map((s) => s.replace(/<\/p>/gi, '').trim())
			.filter(Boolean);
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
 * - 629603.md：單一 section
 * - 2025-11-08-解學習監管.md：完整演講
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
	headers.set('Cache-Control', 'public, max-age=3600');

	return new Response(mdContent, { status: 200, headers });
}
