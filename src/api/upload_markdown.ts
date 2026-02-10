import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';
import { marked } from 'marked';
import { deleteR2Cache } from './cache';

const corsMethods = 'GET, HEAD, OPTIONS, POST, PUT, DELETE';
const speakerLineRegExp = /^#{1,6}\s*(.+?)\s*[:：]\s*$/;

function transformFilename(input: string): string {
	const lower = input.toLowerCase();
	const replaced = lower.replace(/-ai-/g, 'ai-').replace(/\.md$/, '');
	return replaced.slice(0, 50);
}

type SpeakerMark = {
	lineIndex: number;
	speakerSlug: string | null;
};

type ParsedSection = {
	markdown: string;
	isFromQuote: boolean;
	startLine: number;
};

type NormalizedSection = {
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
};

function normalizeSpeakerName(raw: string): string | null {
	const withoutColon = raw.replace(/\s*[:：]\s*$/, '').trim();
	if (!withoutColon) return null;
	const mapped = withoutColon === '唐鳳' ? '唐鳳-3' : withoutColon;
	return encodeURIComponent(mapped);
}

function stripScripts(html: string) {
	return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function parseMarkdownSections(markdown: string): { sections: ParsedSection[]; speakers: SpeakerMark[] } {
	const rawLines = markdown.split('\n');
	const speakers: SpeakerMark[] = [];

	// Phase 1：逐行處理 — 偵測 speaker 行（替換為空行）、剝除 '> ' 前綴、記錄每行是否為 quote
	const processed: string[] = [];
	const lineIsQuote: boolean[] = [];

	for (let i = 0; i < rawLines.length; i++) {
		const raw = rawLines[i];
		const isQuote = raw.startsWith('> ');
		const text = isQuote ? raw.slice(2) : raw;
		const trimmed = text.trim();

		const speakerMatch = speakerLineRegExp.exec(trimmed);
		if (speakerMatch) {
			speakers.push({ lineIndex: i, speakerSlug: normalizeSpeakerName(speakerMatch[1]) });
			processed.push(''); // speaker 行變空行，不進入任何段落
			lineIsQuote.push(false);
			continue;
		}

		processed.push(text);
		lineIsQuote.push(isQuote);
	}

	// Phase 2：以「任一空行」為分界，切成段落（對應 split(/\n{2,}/)）
	const sections: ParsedSection[] = [];
	let buf: string[] = [];
	let sectionStartLine = 0;
	let hasNonQuoteLine = false;

	const flush = () => {
		const content = buf.join('\n').trim();
		if (content) {
			sections.push({
				markdown: content,
				isFromQuote: !hasNonQuoteLine, // 所有行皆來自 '> ' 時才算 quote 段落
				startLine: sectionStartLine
			});
		}
		buf = [];
		hasNonQuoteLine = false;
	};

	for (let i = 0; i < processed.length; i++) {
		const line = processed[i];
		if (line.trim() === '') {
			// 遇到空行就切段
			if (buf.length > 0) {
				flush();
			}
		} else {
			if (buf.length === 0) {
				sectionStartLine = i;
			}
			if (!lineIsQuote[i]) {
				hasNonQuoteLine = true;
			}
			buf.push(line);
		}
	}
	if (buf.length > 0) {
		flush();
	}

	return { sections, speakers };
}

function assignSpeakersToSections(parsed: ParsedSection[], speakerMarks: SpeakerMark[]): Array<ParsedSection & { speaker: string | null }> {
	return parsed.map((section) => {
		if (section.isFromQuote) {
			return { ...section, speaker: null };
		}

		let assigned: string | null = null;
		for (let i = speakerMarks.length - 1; i >= 0; i -= 1) {
			const mark = speakerMarks[i];
			if (mark.lineIndex <= section.startLine) {
				assigned = mark.speakerSlug ?? null;
				break;
			}
		}

		return { ...section, speaker: assigned };
	});
}

async function findMaxSectionId(c: Context<ApiEnv>): Promise<number> {
	// 用 MAX(CAST(...)) 取數值最大，不依賴 ORDER BY；WHERE 同用 CAST 避免型別/索引造成漏列
	const result = await c.env.DB.prepare(
		'SELECT MAX(section_id) FROM speech_content WHERE section_id < 10000000').first<{ max_id: number | null }>();
	const maxId = result?.max_id;
	// D1 可能回傳 string，強制轉數值
	const num = maxId != null ? Number(maxId) : 0;
	const next = Number.isNaN(num) ? 0 : num + 1;
	console.log('[upload_markdown] findMaxSectionId raw:', maxId, '-> next:', next);
	return next;
}

function toHtml(markdown: string): string {
	const html = marked.parse(markdown);
	return stripScripts(typeof html === 'string' ? html : '');
}

async function invalidateSpeechCaches(c: Context<ApiEnv>, filename: string) {
	const host = new URL(c.req.url).host;
	const encodedFilename = encodeURIComponent(filename);
	const r2Keys = [
		`an/${filename}`,
		`md/${filename}`,
		`${host}/${filename}`,
		`${host}/${encodedFilename}`
	];

	await Promise.allSettled(r2Keys.map((key) => deleteR2Cache(c.env.SPEECH_CACHE, key)));
}

export async function uploadMarkdown(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const corsHeadersWithMethods = {
		...corsHeaders,
		'Access-Control-Allow-Methods': corsMethods
	};

	try {
		// Auth check
		const authHeader = c.req.header('Authorization');

		if (!authHeader) {
			return c.text('Forbidden', 400, corsHeadersWithMethods);
		}

		if (!authHeader.startsWith('Bearer ')) {
			return c.text('Forbidden', 400, corsHeadersWithMethods);
		}

		const token = authHeader.slice(7);

		const audreytToken = c.env.AUDREYT_TRANSCRIPT_TOKEN;
		const bestianToken = c.env.BESTIAN_TRANSCRIPT_TOKEN;

		if (!token || (token !== audreytToken && token !== bestianToken)) {
			return c.text('Forbidden', 400, corsHeadersWithMethods);
		}

		const method = c.req.method;

		if (method === 'DELETE') {
			// DELETE: 從 body 讀取 filename，刪除 D1 中的紀錄

			console.log('[upload_markdown] DELETE');
			let body: { filename?: string };

			try {
				body = await c.req.json();
				console.log('[upload_markdown] DELETE body:', body);

				if (!body.filename || typeof body.filename !== 'string') {
					return c.json({ error: 'Missing or invalid filename field' }, 400, corsHeadersWithMethods);
				}

				const inputFilename = body.filename.trim();

				if (!inputFilename) {
					return c.json({ error: 'Filename cannot be empty' }, 400, corsHeadersWithMethods);
				}

				const filename = transformFilename(inputFilename);
				console.log('[upload_markdown] filename transform:', { input: inputFilename, output: filename });

				// Delete from D1: speech_content (sections)
				console.log('[upload_markdown] DELETE sections from D1:', filename);
				const deleteSectionsResult = await c.env.DB.prepare(
					'DELETE FROM speech_content WHERE filename = ?'
				)
					.bind(filename)
					.run();

				// Delete from D1: speech_index (speech metadata)
				console.log('[upload_markdown] DELETE speech_index from D1:', filename);
				const deleteSpeechResult = await c.env.DB.prepare(
					'DELETE FROM speech_index WHERE filename = ?'
				)
					.bind(filename)
					.run();

				const sectionsDeleted = deleteSectionsResult.meta?.changes ?? 0;
				const speechDeleted = deleteSpeechResult.meta?.changes ?? 0;

				if (sectionsDeleted === 0 && speechDeleted === 0) {
					return c.json(
						{
							success: false,
							message: `No records found for filename: ${filename}`,
							deleted: { sections: 0, speech: 0 }
						},
						404,
						corsHeadersWithMethods
					);
				}

				await invalidateSpeechCaches(c, filename);

				return c.json(
					{
						success: true,
						message: `Successfully deleted ${filename}`,
						deleted: {
							sections: sectionsDeleted,
							speech: speechDeleted
						}
					},
					200,
					corsHeadersWithMethods
				);
			} catch (err) {
				console.error('[upload_markdown] DELETE JSON parse error', err);
				return c.json({ error: 'Invalid JSON body' }, 400, corsHeadersWithMethods);
			}
		} else if (method === 'POST') {
			// POST: 讀取 filename, markdown 欄位，回傳原始內容
			let body: { filename?: string; markdown?: string };
			try {
				body = await c.req.json();
				console.log('[upload_markdown] POST body:', body);
			} catch (err) {
				console.error('[upload_markdown] POST JSON parse error', err);
				return c.json({ error: 'Invalid JSON body' }, 400, corsHeadersWithMethods);
			}

			const raw_filename = body.filename;
			if (!raw_filename || typeof raw_filename !== 'string') {
				return c.json({ error: 'Missing or invalid filename field' }, 400, corsHeadersWithMethods);
			}
			const filename = transformFilename(raw_filename.trim());
			const markdown = body.markdown as string;
			console.log('[upload_markdown] POST filename:', filename);
			console.log('[upload_markdown] POST markdown:', markdown);

			if (!body.markdown || typeof body.markdown !== 'string') {
				return c.json({ error: 'Missing or invalid markdown field' }, 400, corsHeadersWithMethods);
			}

			// 檢查 speech_index 是否已有此 filename
			const existing = await c.env.DB.prepare(
				'SELECT filename FROM speech_index WHERE filename = ?'
			)
				.bind(filename)
				.first<{ filename: string }>();

			if (existing) {
				console.log('[upload_markdown] POST speech_index 已存在:', filename);
				return c.json(
					{ success: false, message: 'Filename already exists in speech index', filename },
					409,
					corsHeadersWithMethods
				);
			}

			// 從 markdown 第一行解析 display_name：去掉開頭 '# '
			const firstLine = body.markdown.split('\n')[0]?.trim() ?? '';
			const display_name = firstLine.replace(/^#\s*/, '') || filename;

			// 不存在則新增一筆 speech_index
			await c.env.DB.prepare(
				'INSERT INTO speech_index (filename, display_name, isNested, nest_filenames, nest_display_names) VALUES (?, ?, 0, ?, ?)'
			)
				.bind(filename, display_name, '', '')
				.run();
			console.log('[upload_markdown] POST speech_index 新增:', filename);

			const { sections: parsedSections, speakers } = parseMarkdownSections(markdown);
			const sectionsWithSpeaker = assignSpeakersToSections(parsedSections, speakers);
			const baseSectionId = await findMaxSectionId(c);

			const normalized: NormalizedSection[] = sectionsWithSpeaker.map((section, idx) => {
				const section_id = baseSectionId - idx;
				const previous_section_id = idx === 0 ? null : section_id + 1;
				const next_section_id = idx === sectionsWithSpeaker.length - 1 ? null : section_id - 1;
				const section_content = toHtml(section.markdown);

				return {
					section_id,
					previous_section_id,
					next_section_id,
					section_speaker: section.speaker,
					section_content
				};
			});

			for (const section of normalized) {
				await c.env.DB.prepare(
					'INSERT INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
				)
					.bind(
						filename,
						null,
						null,
						section.section_id,
						section.previous_section_id,
						section.next_section_id,
						section.section_speaker,
						section.section_content
					)
					.run();
			}

			console.log(
				'[upload_markdown] POST section_content:\n',
				normalized.map((s) => s.section_content).join('\n\n')
			);

			return c.json(
				{ success: true, filename, sectionsCount: normalized.length },
				200,
				corsHeadersWithMethods
			);
		} else {
			console.error('[upload_markdown] method not supported', method);
			return c.json({ error: 'Method not supported' }, 400, corsHeadersWithMethods);
		}
	} catch (error) {
		console.error('[upload_markdown] error', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeadersWithMethods);
	}
}
