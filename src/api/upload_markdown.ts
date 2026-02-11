import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';
import { marked } from 'marked';
import { deleteR2Cache } from './cache';

const corsMethods = 'GET, HEAD, OPTIONS, POST, PATCH, DELETE';
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

type ExistingSection = {
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
};

type SectionPayload = {
	markdown: string;
	speaker: string | null;
	section_content: string;
};

type PatchAssignedSection = SectionPayload & { section_id: number };

function getUniqueSpeakerRoutePathnames(speakerMarks: SpeakerMark[]): string[] {
	return Array.from(
		new Set(
			speakerMarks
				.map((s) => s.speakerSlug)
				.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
		)
	);
}

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
		'SELECT MAX(section_id) AS max_id FROM speech_content WHERE section_id < 10000000'
	).first<{ max_id: number | null }>();
	const maxId = result?.max_id;
	// D1 可能回傳 string，強制轉數值
	const num = maxId != null ? Number(maxId) : 0;
	const next = Number.isNaN(num) ? 0 : num + 1;
	return next;
}

function toHtml(markdown: string): string {
	const html = marked.parse(markdown);
	return stripScripts(typeof html === 'string' ? html : '');
}

function stripMarkdownTitleLine(markdown: string): string {
	const mdLines = markdown.split('\n');
	if (mdLines[0] && /^#\s/.test(mdLines[0].trim())) {
		mdLines[0] = '';
	}
	return mdLines.join('\n');
}

function sectionMatchKey(section: { markdown: string; speaker: string | null }) {
	return `${section.speaker ?? ''}\u0000${section.markdown}`;
}

function isSubSectionId(sectionId: number) {
	return String(Math.abs(sectionId)).length > 7;
}

function orderSectionsByLinks(rows: ExistingSection[]): ExistingSection[] {
	if (rows.length <= 1) return rows;
	const byId = new Map<number, ExistingSection>();
	for (const row of rows) {
		byId.set(row.section_id, row);
	}

	let head: ExistingSection | null = null;
	for (const row of rows) {
		if (row.previous_section_id == null || !byId.has(row.previous_section_id)) {
			if (!head || row.section_id < head.section_id) {
				head = row;
			}
		}
	}

	if (!head) return [...rows].sort((a, b) => a.section_id - b.section_id);

	const ordered: ExistingSection[] = [];
	const visited = new Set<number>();
	let current: ExistingSection | null = head;
	while (current && !visited.has(current.section_id)) {
		ordered.push(current);
		visited.add(current.section_id);
		const nextId: number | null = current.next_section_id;
		current = nextId != null ? byId.get(nextId) ?? null : null;
	}

	if (ordered.length !== rows.length) {
		const remains = rows.filter((r) => !visited.has(r.section_id)).sort((a, b) => a.section_id - b.section_id);
		ordered.push(...remains);
	}

	return ordered;
}

function buildLcsPairs(oldSections: SectionPayload[], newSections: SectionPayload[]): Array<[number, number]> {
	const n = oldSections.length;
	const m = newSections.length;
	const oldKeys = oldSections.map(sectionMatchKey);
	const newKeys = newSections.map(sectionMatchKey);
	const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));

	for (let i = 1; i <= n; i += 1) {
		for (let j = 1; j <= m; j += 1) {
			if (oldKeys[i - 1] === newKeys[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
			else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}

	const pairs: Array<[number, number]> = [];
	let i = n;
	let j = m;
	while (i > 0 && j > 0) {
		if (oldKeys[i - 1] === newKeys[j - 1]) {
			pairs.push([i - 1, j - 1]);
			i -= 1;
			j -= 1;
		} else if (dp[i - 1][j] >= dp[i][j - 1]) {
			i -= 1;
		} else {
			j -= 1;
		}
	}

	return pairs.reverse();
}

function appendInsertedSections(
	output: PatchAssignedSection[],
	newInserts: SectionPayload[],
	baseIdHint: number | null,
	usedIds: Set<number>
) {
	if (newInserts.length === 0) return;
	if (newInserts.length > 99) throw new Error('Too many inserted sections in a single gap (max 99)');

	const fallbackBase = output.length > 0 ? output[output.length - 1].section_id : baseIdHint;
	if (fallbackBase == null) throw new Error('Unable to assign ID for inserted sections without base section');

	let nextCandidate = isSubSectionId(fallbackBase) ? fallbackBase + 1 : fallbackBase * 100 + 1;
	for (const insertSection of newInserts) {
		let safety = 0;
		while (usedIds.has(nextCandidate) && safety < 300) {
			nextCandidate += 1;
			safety += 1;
		}
		if (usedIds.has(nextCandidate)) throw new Error('Section ID allocation overflow for inserted sections');
		usedIds.add(nextCandidate);
		output.push({ ...insertSection, section_id: nextCandidate });
		nextCandidate += 1;
	}
}

function assignPatchedSections(oldRows: ExistingSection[], newSections: SectionPayload[]): PatchAssignedSection[] {
	const oldSections: Array<SectionPayload & { section_id: number }> = oldRows.map((row) => ({
		section_id: row.section_id,
		markdown: row.section_content,
		speaker: row.section_speaker,
		section_content: row.section_content
	}));
	const output: PatchAssignedSection[] = [];
	const usedIds = new Set<number>(oldRows.map((row) => row.section_id));
	let oldCursor = 0;
	let newCursor = 0;

	// Special case: 改第一段（新第一段是陌生內容）時，強制沿用舊第一段 section_id
	if (
		oldSections.length > 0 &&
		newSections.length > 0 &&
		sectionMatchKey(oldSections[0]) !== sectionMatchKey(newSections[0])
	) {
		output.push({ ...newSections[0], section_id: oldSections[0].section_id });
		oldCursor = 1;
		newCursor = 1;
	}

	const lcsPairs = buildLcsPairs(oldSections.slice(oldCursor), newSections.slice(newCursor)).map(
		([oldIdx, newIdx]) => [oldIdx + oldCursor, newIdx + newCursor] as [number, number]
	);

	for (const [oldMatchIdx, newMatchIdx] of lcsPairs) {
		const oldGap = oldSections.slice(oldCursor, oldMatchIdx);
		const newGap = newSections.slice(newCursor, newMatchIdx);
		const pairedCount = Math.min(oldGap.length, newGap.length);

		for (let k = 0; k < pairedCount; k += 1) {
			output.push({ ...newGap[k], section_id: oldGap[k].section_id });
		}

		if (newGap.length > oldGap.length) {
			const baseIdHint =
				pairedCount > 0
					? oldGap[pairedCount - 1].section_id
					: output.length > 0
						? output[output.length - 1].section_id
						: oldSections[0]?.section_id ?? null;
			appendInsertedSections(output, newGap.slice(pairedCount), baseIdHint, usedIds);
		}

		output.push({ ...newSections[newMatchIdx], section_id: oldSections[oldMatchIdx].section_id });
		oldCursor = oldMatchIdx + 1;
		newCursor = newMatchIdx + 1;
	}

	const oldTail = oldSections.slice(oldCursor);
	const newTail = newSections.slice(newCursor);
	const tailPairCount = Math.min(oldTail.length, newTail.length);

	for (let k = 0; k < tailPairCount; k += 1) {
		output.push({ ...newTail[k], section_id: oldTail[k].section_id });
	}

	if (newTail.length > oldTail.length) {
		const baseIdHint =
			tailPairCount > 0
				? oldTail[tailPairCount - 1].section_id
				: output.length > 0
					? output[output.length - 1].section_id
					: oldSections[0]?.section_id ?? null;
		appendInsertedSections(output, newTail.slice(tailPairCount), baseIdHint, usedIds);
	}

	return output;
}

async function parseIncomingMarkdown(markdown: string) {
	const markdownForParsing = stripMarkdownTitleLine(markdown);
	const { sections: parsedSections, speakers } = parseMarkdownSections(markdownForParsing);
	const sectionsWithSpeaker = assignSpeakersToSections(parsedSections, speakers);
	return {
		speakers,
		sectionPayloads: sectionsWithSpeaker.map((section) => ({
			markdown: section.markdown,
			speaker: section.speaker,
			section_content: toHtml(section.markdown)
		}))
	};
}

function withSectionLinks(sections: PatchAssignedSection[]): NormalizedSection[] {
	return sections.map((section, idx) => ({
		section_id: section.section_id,
		previous_section_id: idx === 0 ? null : sections[idx - 1].section_id,
		next_section_id: idx === sections.length - 1 ? null : sections[idx + 1].section_id,
		section_speaker: section.speaker,
		section_content: section.section_content
	}));
}

async function ensureSpeakersExist(c: Context<ApiEnv>, speakerMarks: SpeakerMark[]) {
	const uniqueRoutePathnames = getUniqueSpeakerRoutePathnames(speakerMarks);

	for (const routePathname of uniqueRoutePathnames) {
		let speakerName = routePathname;
		try {
			speakerName = decodeURIComponent(routePathname);
		} catch {
			// route_pathname 非合法 URI 編碼時，退回原字串，避免整批中斷
			speakerName = routePathname;
		}

		await c.env.DB.prepare(
			'INSERT INTO speakers (route_pathname, name, photoURL) VALUES (?, ?, NULL) ON CONFLICT(route_pathname) DO NOTHING'
		)
			.bind(routePathname, speakerName)
			.run();
	}
}

async function ensureSpeechSpeakerRelations(c: Context<ApiEnv>, filename: string, speakerMarks: SpeakerMark[]) {
	const uniqueRoutePathnames = getUniqueSpeakerRoutePathnames(speakerMarks);

	console.log('[upload_markdown][relation] target filename:', filename);
	console.log('[upload_markdown][relation] parsed speakers:', uniqueRoutePathnames);

	const beforeCountRow = await c.env.DB.prepare(
		'SELECT COUNT(*) AS count FROM speech_speakers WHERE speech_filename = ?'
	)
		.bind(filename)
		.first<{ count: number | string }>();
	const beforeCount = Number(beforeCountRow?.count ?? 0);
	console.log('[upload_markdown][relation] before count:', beforeCount);

	let inserted = 0;
	let ignored = 0;
	for (const routePathname of uniqueRoutePathnames) {
		const relationInsertResult = await c.env.DB.prepare(
			'INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES (?, ?)'
		)
			.bind(filename, routePathname)
			.run();
		const changes = relationInsertResult.meta?.changes ?? 0;
		if (changes > 0) inserted += changes;
		else ignored += 1;
		console.log('[upload_markdown][relation] upsert', {
			filename,
			routePathname,
			changes
		});
	}

	const afterCountRow = await c.env.DB.prepare(
		'SELECT COUNT(*) AS count FROM speech_speakers WHERE speech_filename = ?'
	)
		.bind(filename)
		.first<{ count: number | string }>();
	const afterCount = Number(afterCountRow?.count ?? 0);
	console.log('[upload_markdown][relation] summary', {
		beforeCount,
		parsedCount: uniqueRoutePathnames.length,
		inserted,
		ignored,
		afterCount
	});
}

async function rebuildSpeechSpeakerRelations(c: Context<ApiEnv>, filename: string, routePathnames: string[]) {
	await c.env.DB.prepare('DELETE FROM speech_speakers WHERE speech_filename = ?').bind(filename).run();
	for (const routePathname of routePathnames) {
		await c.env.DB.prepare(
			'INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES (?, ?)'
		)
			.bind(filename, routePathname)
			.run();
	}
}

async function pruneOrphanSpeakers(c: Context<ApiEnv>, routePathnames: string[]) {
	for (const routePathname of routePathnames) {
		const stillLinked = await c.env.DB.prepare(
			'SELECT 1 AS linked FROM speech_speakers WHERE speaker_route_pathname = ? LIMIT 1'
		)
			.bind(routePathname)
			.first<{ linked: number }>();
		if (!stillLinked) {
			await c.env.DB.prepare('DELETE FROM speakers WHERE route_pathname = ?').bind(routePathname).run();
		}
	}
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

async function invalidateSpeakerCaches(c: Context<ApiEnv>, speakerRoutePathnames: string[]) {
	const host = new URL(c.req.url).host;
	const keys = new Set<string>([`${host}/speakers`]);

	for (const routePathname of speakerRoutePathnames) {
		if (!routePathname) continue;
		keys.add(`${host}/speaker/${routePathname}`);
		keys.add(`${host}/speaker/${encodeURIComponent(routePathname)}`);
	}

	await Promise.allSettled(Array.from(keys).map((key) => deleteR2Cache(c.env.SPEECH_CACHE, key)));
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

				// 先找出此演講關聯到的講者，供後續孤兒講者清理
				const linkedSpeakers = await c.env.DB.prepare(
					'SELECT speaker_route_pathname FROM speech_speakers WHERE speech_filename = ?'
				)
					.bind(filename)
					.all<{ speaker_route_pathname: string }>();
				const speakerRoutePathnames = Array.from(
					new Set((linkedSpeakers.results ?? []).map((row) => row.speaker_route_pathname).filter(Boolean))
				);

				// Delete from D1: speech_speakers (speech-speaker relations)
				console.log('[upload_markdown] DELETE speech_speakers from D1:', filename);
				const deleteSpeechSpeakersResult = await c.env.DB.prepare(
					'DELETE FROM speech_speakers WHERE speech_filename = ?'
				)
					.bind(filename)
					.run();

				// 刪除僅屬於此演講、且已無任何關聯的講者
				let speakersDeleted = 0;
				for (const routePathname of speakerRoutePathnames) {
					const stillLinked = await c.env.DB.prepare(
						'SELECT 1 AS linked FROM speech_speakers WHERE speaker_route_pathname = ? LIMIT 1'
					)
						.bind(routePathname)
						.first<{ linked: number }>();
					if (!stillLinked) {
						const deleteSpeakerResult = await c.env.DB.prepare(
							'DELETE FROM speakers WHERE route_pathname = ?'
						)
							.bind(routePathname)
							.run();
						speakersDeleted += deleteSpeakerResult.meta?.changes ?? 0;
					}
				}

				// Delete from D1: speech_index (speech metadata)
				console.log('[upload_markdown] DELETE speech_index from D1:', filename);
				const deleteSpeechResult = await c.env.DB.prepare(
					'DELETE FROM speech_index WHERE filename = ?'
				)
					.bind(filename)
					.run();

				const sectionsDeleted = deleteSectionsResult.meta?.changes ?? 0;
				const relationsDeleted = deleteSpeechSpeakersResult.meta?.changes ?? 0;
				const speechDeleted = deleteSpeechResult.meta?.changes ?? 0;

				if (sectionsDeleted === 0 && relationsDeleted === 0 && speechDeleted === 0) {
					return c.json(
						{
							success: false,
							message: `No records found for filename: ${filename}`,
							deleted: { sections: 0, relations: 0, speakers: 0, speech: 0 }
						},
						404,
						corsHeadersWithMethods
					);
				}

				await invalidateSpeechCaches(c, filename);
				await invalidateSpeakerCaches(c, speakerRoutePathnames);

				return c.json(
					{
						success: true,
						message: `Successfully deleted ${filename}`,
						deleted: {
							sections: sectionsDeleted,
							relations: relationsDeleted,
							speakers: speakersDeleted,
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

			const { speakers, sectionPayloads } = await parseIncomingMarkdown(markdown);
			const speakerRoutePathnames = getUniqueSpeakerRoutePathnames(speakers);
			await ensureSpeakersExist(c, speakers);
			await ensureSpeechSpeakerRelations(c, filename, speakers);
			const baseSectionId = await findMaxSectionId(c);

			const normalized: NormalizedSection[] = sectionPayloads.map((section, idx) => {
				const section_id = baseSectionId + idx;
				const previous_section_id = idx === 0 ? null : section_id - 1;
				const next_section_id = idx === sectionPayloads.length - 1 ? null : section_id + 1;

				return {
					section_id,
					previous_section_id,
					next_section_id,
					section_speaker: section.speaker,
					section_content: section.section_content
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

			await invalidateSpeechCaches(c, filename);
			await invalidateSpeakerCaches(c, speakerRoutePathnames);

			return c.json(
				{ success: true, filename, sectionsCount: normalized.length },
				200,
				corsHeadersWithMethods
			);
		} else if (method === 'PATCH') {
			let body: { filename?: string; markdown?: string };
			try {
				body = await c.req.json();
			} catch (err) {
				console.error('[upload_markdown] PATCH JSON parse error', err);
				return c.json({ error: 'Invalid JSON body' }, 400, corsHeadersWithMethods);
			}

			const rawFilename = body.filename;
			if (!rawFilename || typeof rawFilename !== 'string') {
				return c.json({ error: 'Missing or invalid filename field' }, 400, corsHeadersWithMethods);
			}
			if (!body.markdown || typeof body.markdown !== 'string') {
				return c.json({ error: 'Missing or invalid markdown field' }, 400, corsHeadersWithMethods);
			}

			const filename = transformFilename(rawFilename.trim());
			const markdown = body.markdown;
			const existingSpeech = await c.env.DB.prepare(
				'SELECT filename FROM speech_index WHERE filename = ?'
			)
				.bind(filename)
				.first<{ filename: string }>();
			if (!existingSpeech) {
				return c.json(
					{ success: false, message: 'Filename not found in speech index', filename },
					404,
					corsHeadersWithMethods
				);
			}

			const firstLine = markdown.split('\n')[0]?.trim() ?? '';
			const displayName = firstLine.replace(/^#\s*/, '') || filename;
			const oldSectionsRaw = await c.env.DB.prepare(
				`SELECT section_id, previous_section_id, next_section_id, section_speaker, section_content
				 FROM speech_content
				 WHERE filename = ?
				 ORDER BY section_id ASC`
			)
				.bind(filename)
				.all<ExistingSection>();
			const oldSections = orderSectionsByLinks(
				(oldSectionsRaw.results ?? []).map((row) => ({
					section_id: Number(row.section_id),
					previous_section_id: row.previous_section_id != null ? Number(row.previous_section_id) : null,
					next_section_id: row.next_section_id != null ? Number(row.next_section_id) : null,
					section_speaker: row.section_speaker ?? null,
					section_content: row.section_content ?? ''
				}))
			);
			const oldSpeakerRows = await c.env.DB.prepare(
				'SELECT speaker_route_pathname FROM speech_speakers WHERE speech_filename = ?'
			)
				.bind(filename)
				.all<{ speaker_route_pathname: string }>();
			const oldSpeakerRoutePathnames = Array.from(
				new Set((oldSpeakerRows.results ?? []).map((row) => row.speaker_route_pathname).filter(Boolean))
			);

			const { speakers, sectionPayloads } = await parseIncomingMarkdown(markdown);
			const newSpeakerRoutePathnames = getUniqueSpeakerRoutePathnames(speakers);

			let assignedPatched: PatchAssignedSection[];
			try {
				assignedPatched = assignPatchedSections(oldSections, sectionPayloads);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to assign section ids for PATCH';
				return c.json({ success: false, message, filename }, 409, corsHeadersWithMethods);
			}

			const normalized = withSectionLinks(assignedPatched);
			const oldSectionIds = new Set(oldSections.map((section) => section.section_id));
			const finalSectionIds = new Set(normalized.map((section) => section.section_id));
			const impactedSpeakers = Array.from(new Set([...oldSpeakerRoutePathnames, ...newSpeakerRoutePathnames]));

			// Build all write statements for a single atomic D1 batch
			const batchStatements: D1PreparedStatement[] = [];

			// 1. Update display_name
			batchStatements.push(
				c.env.DB.prepare('UPDATE speech_index SET display_name = ? WHERE filename = ?')
					.bind(displayName, filename)
			);

			// 2. Ensure speakers exist (idempotent upserts)
			for (const routePathname of newSpeakerRoutePathnames) {
				let speakerName = routePathname;
				try {
					speakerName = decodeURIComponent(routePathname);
				} catch {
					speakerName = routePathname;
				}
				batchStatements.push(
					c.env.DB.prepare(
						'INSERT INTO speakers (route_pathname, name, photoURL) VALUES (?, ?, NULL) ON CONFLICT(route_pathname) DO NOTHING'
					).bind(routePathname, speakerName)
				);
			}

			// 3. Update/Insert sections
			for (const section of normalized) {
				if (oldSectionIds.has(section.section_id)) {
					batchStatements.push(
						c.env.DB.prepare(
							`UPDATE speech_content
							 SET filename = ?,
								 nest_filename = ?,
								 nest_display_name = ?,
								 previous_section_id = ?,
								 next_section_id = ?,
								 section_speaker = ?,
								 section_content = ?
							 WHERE section_id = ?`
						).bind(
							filename,
							null,
							null,
							section.previous_section_id,
							section.next_section_id,
							section.section_speaker,
							section.section_content,
							section.section_id
						)
					);
				} else {
					batchStatements.push(
						c.env.DB.prepare(
							'INSERT INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
						).bind(
							filename,
							null,
							null,
							section.section_id,
							section.previous_section_id,
							section.next_section_id,
							section.section_speaker,
							section.section_content
						)
					);
				}
			}

			// 4. Delete removed sections
			for (const oldSection of oldSections) {
				if (!finalSectionIds.has(oldSection.section_id)) {
					batchStatements.push(
						c.env.DB.prepare('DELETE FROM speech_content WHERE filename = ? AND section_id = ?')
							.bind(filename, oldSection.section_id)
					);
				}
			}

			// 5. Rebuild speech-speaker relations
			batchStatements.push(
				c.env.DB.prepare('DELETE FROM speech_speakers WHERE speech_filename = ?').bind(filename)
			);
			for (const routePathname of newSpeakerRoutePathnames) {
				batchStatements.push(
					c.env.DB.prepare(
						'INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES (?, ?)'
					).bind(filename, routePathname)
				);
			}

			// 6. Prune orphan speakers
			for (const routePathname of impactedSpeakers) {
				batchStatements.push(
					c.env.DB.prepare(
						'DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS (SELECT 1 FROM speech_speakers WHERE speaker_route_pathname = ?)'
					).bind(routePathname, routePathname)
				);
			}

			await c.env.DB.batch(batchStatements);

			// Invalidate caches (R2, outside the D1 transaction)
			await invalidateSpeechCaches(c, filename);
			await invalidateSpeakerCaches(c, impactedSpeakers);
			await invalidateSpeechesList(c);

			return c.json(
				{
					success: true,
					filename,
					sectionsCount: normalized.length,
					insertedCount: normalized.filter((section) => !oldSectionIds.has(section.section_id)).length,
					updatedCount: normalized.filter((section) => oldSectionIds.has(section.section_id)).length,
					deletedCount: oldSections.filter((section) => !finalSectionIds.has(section.section_id)).length
				},
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
