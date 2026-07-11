import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import { isAuthorizedFromHeader } from './auth';
import type { ApiEnv } from './types';
import { marked } from 'marked';
import { deleteR2Cache, purgeWorkersCache, speechRequestPath, speakerRequestPath, tags } from './cache';
import { markSpeechDeletedInSearch, syncSearchStats, writeSearchOverlayForSpeech } from '../search/runtime';
import { orderSectionsByLinks, assignPatchedSections, withSectionLinks } from '../utils/sectionPatch';
import type { NormalizedSection, ExistingSection, PatchAssignedSection } from '../utils/sectionPatch';
import { planSpeechInvalidation, planSpeakerInvalidation, planListInvalidation } from '../utils/cachePlan';

const corsMethods = 'GET, HEAD, OPTIONS, POST, PATCH, DELETE';

/** Retry a D1 operation up to `maxAttempts` times with exponential backoff */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 200): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			console.warn(`[upload_markdown] DB operation failed (attempt ${attempt}/${maxAttempts})`, err);
			if (attempt < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
			}
		}
	}
	throw lastError;
}
/** 辨識「講者標題行」：開頭 1～6 個 #、結尾為 : 或 ： */
const speakerLineRegExp = /^#{1,6}\s*(.+?)\s*[:：]\s*$/;

/** 將使用者輸入的檔名正規化（小寫、去 .md、全形冒號→連字號、最多 50 字） */
function transformFilename(input: string): string {
	const lower = input.toLowerCase();
	const replaced = lower.replace(/\.md$/, '').replace(/：/g, '-');
	return replaced.slice(0, 50);
}

/** FNV-1a 32-bit hash → 7-char base36. Deterministic, dependency-free. */
function shortHash(value: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < value.length; i += 1) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36).padStart(7, '0').slice(-7);
}

/**
 * A bounded but collision-resistant storage key for a raw filename. For names
 * within the 50-char budget this is byte-identical to transformFilename (so
 * existing keys/URLs are untouched). Longer names — which transformFilename
 * truncates to a shared 50-char prefix, letting two distinct transcripts collapse
 * onto one key and silently clobber each other — instead get a short deterministic
 * hash of the FULL normalized name appended, keeping the key injective on source.
 * Only minted by the POST/PATCH title-collision guard, never for the common path.
 */
function collisionResistantKey(input: string): string {
	const normalized = input.toLowerCase().replace(/\.md$/, '').replace(/：/g, '-');
	if (normalized.length <= 50) return normalized;
	return `${normalized.slice(0, 42)}-${shortHash(normalized)}`;
}

/**
 * 若該 filename 已被合併到 canonical 版本（speech_redirects.old_filename 命中），
 * 回傳 canonical 的 new_filename；否則回 null。
 *
 * 用途：POST / PATCH / DELETE 進來時，先試 speech_index 直接命中；沒命中再查
 * 此函式，避免被合併掉的 deprecated filename 又被自動 upsert 出新一份重複。
 */
async function lookupRedirectTarget(c: any, filename: string): Promise<string | null> {
	const row = await withRetry(() =>
		c.env.DB.prepare('SELECT new_filename FROM speech_redirects WHERE old_filename = ?').bind(filename).first(),
	);
	const target = (row as { new_filename?: string } | null)?.new_filename;
	return typeof target === 'string' && target.length > 0 ? target : null;
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

/** 從講者標記陣列取出不重複的 route_pathname（用於 DB 關聯與快取失效） */
function getUniqueSpeakerRoutePathnames(speakerMarks: SpeakerMark[]): string[] {
	return Array.from(
		new Set(speakerMarks.map((s) => s.speakerSlug).filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)),
	);
}

/** 講者名稱正規化：去結尾冒號、唐鳳→唐鳳-3、最後 encodeURIComponent 作為 route_pathname */
function normalizeSpeakerName(raw: string): string | null {
	const withoutColon = raw.replace(/\s*[:：]\s*$/, '').trim();
	if (!withoutColon) return null;
	const mapped = withoutColon === '唐鳳' ? '唐鳳-3' : withoutColon;
	return encodeURIComponent(mapped);
}

/** 移除 HTML 中的 <script> 區塊，避免 XSS */
function stripScripts(html: string) {
	return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/** 解析 Markdown：分出段落（sections）與講者標記（speakers），quote 行（> ）會標記 isFromQuote */
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
		// buf only ever holds lines that already passed the non-blank-after-trim
		// check below, so the joined+trimmed content is always non-empty here.
		const content = buf.join('\n').trim();
		sections.push({
			markdown: content,
			isFromQuote: !hasNonQuoteLine, // 所有行皆來自 '> ' 時才算 quote 段落
			startLine: sectionStartLine,
		});
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

/** 為每個段落指派講者：取「該段落 startLine 之前、最近一筆」講者標記；quote 段落不指派 */
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

/**
 * Atomically reserve a contiguous block of `count` fresh section_ids and return
 * the FIRST id of the block (the block is [start, start + count - 1]).
 *
 * speech_content.section_id is a GLOBAL INTEGER PRIMARY KEY. The previous scheme
 * read MAX(section_id) and then computed MAX+1.. in JS before a separate INSERT,
 * which (a) raced — two concurrent uploads read the same MAX and minted the same
 * ids, colliding on the PK and surfacing as HTTP 503 — and (b) tried to place
 * inserted sections at positional `base*100+N` ids that collided with other
 * speeches. Both are eliminated here: the reservation is a SINGLE atomic
 * UPDATE … RETURNING against a dedicated counter row, so SQLite serialises
 * concurrent reservations into disjoint blocks, and the counter is always bumped
 * to at least MAX(section_id)+1 (self-healing) so every reserved id is strictly
 * greater than any existing row — collision-free by construction.
 *
 * Reserved ids are pure identity, never positional; display order is carried by
 * the previous/next link chain (see sectionUtils), so gaps are harmless.
 */
async function reserveSectionIds(c: Context<ApiEnv>, count: number): Promise<number> {
	const n = Math.max(1, Math.floor(count));
	// Idempotent: create the counter table + seed row if missing. The seed value
	// (0) is irrelevant because the reservation below floors next_id at MAX+1.
	await withRetry(() =>
		c.env.DB.batch([
			c.env.DB.prepare('CREATE TABLE IF NOT EXISTS section_id_counter (id INTEGER PRIMARY KEY, next_id INTEGER NOT NULL)'),
			c.env.DB.prepare('INSERT OR IGNORE INTO section_id_counter (id, next_id) VALUES (1, 0)'),
		]),
	);
	// The atomic reservation: one statement, serialised by SQLite's write lock.
	// next_id := max(current counter, MAX(section_id)+1) + n ; reserved block is
	// the n ids immediately below the returned next_id.
	const row = await withRetry(() =>
		c.env.DB.prepare(
			`UPDATE section_id_counter
			 SET next_id = MAX(next_id, (SELECT COALESCE(MAX(section_id), 0) + 1 FROM speech_content)) + ?
			 WHERE id = 1
			 RETURNING next_id`,
		)
			.bind(n)
			.first<{ next_id: number | string }>(),
	);
	const newNext = row != null ? Number(row.next_id) : NaN;
	if (!Number.isFinite(newNext)) {
		throw new Error('reserveSectionIds: counter update returned no row');
	}
	return newNext - n;
}

/** Markdown 轉 HTML 並移除 <script> */
function toHtml(markdown: string): string {
	return stripScripts(marked.parse(markdown) as string);
}

/** 若第一行是 # 標題則清空，避免重複當成段落內容 */
function stripMarkdownTitleLine(markdown: string): string {
	const mdLines = markdown.split('\n');
	if (mdLines[0] && /^#\s/.test(mdLines[0].trim())) {
		mdLines[0] = '';
	}
	return mdLines.join('\n');
}

/** 解析上傳的 Markdown：去標題行、切段落、指派講者、轉 HTML，回傳 speakers 與 sectionPayloads */
async function parseIncomingMarkdown(markdown: string) {
	const markdownForParsing = stripMarkdownTitleLine(markdown);
	const { sections: parsedSections, speakers } = parseMarkdownSections(markdownForParsing);
	const sectionsWithSpeaker = assignSpeakersToSections(parsedSections, speakers);
	return {
		speakers,
		sectionPayloads: sectionsWithSpeaker.map((section) => ({
			markdown: section.markdown,
			speaker: section.speaker,
			section_content: toHtml(section.markdown),
		})),
	};
}

/** 演講內容或 .an/.md 更新後，刪除 R2 origin 並 purge Workers Cache.
 *  extraSectionIds: section IDs that may no longer exist in D1 (deleted/reassigned on PATCH/DELETE)
 *  but still need R2 + Workers Cache purge for /speech/:id pages.
 */
async function invalidateSpeechCaches(c: Context<ApiEnv>, filename: string, extraSectionIds: Iterable<number> = []): Promise<boolean> {
	const host = new URL(c.req.url).host;
	// pathPrefixes: request-path encoding only (percent-encoded). Raw Unicode prefixes can fail purge.
	// List roots use tags only — never pathPrefix '/'.
	const pathPrefixes = [speechRequestPath(filename)];
	const sectionIds = new Set<number>();
	for (const id of extraSectionIds) {
		if (Number.isFinite(id)) sectionIds.add(Number(id));
	}

	try {
		const result = await c.env.DB.prepare('SELECT section_id FROM speech_content WHERE filename = ?').bind(filename).all();
		for (const row of result.results as Array<{ section_id: number }>) {
			sectionIds.add(Number(row.section_id));
		}
	} catch (err) {
		console.error('[invalidate] section query error', err);
	}

	for (const sectionId of sectionIds) {
		pathPrefixes.push(`/speech/${sectionId}`);
	}

	const { r2Keys, tags: purgeTags } = planSpeechInvalidation(host, filename, [...sectionIds]);
	// Both tiers must clear: R2 origin delete AND Workers Cache purge.
	// If R2 delete fails but front purge succeeds, the next MISS re-poisons the front from stale R2.
	const r2Results = await Promise.all(r2Keys.map((key) => deleteR2Cache(c.env.SPEECH_CACHE, key)));
	const r2Ok = r2Results.every(Boolean);
	if (!r2Ok) {
		console.error('[invalidate] R2 origin delete incomplete', { filename, failed: r2Results.filter((ok) => !ok).length });
	}
	// Split tags vs pathPrefixes so a bad prefix cannot block tag purge.
	const [tagsOk, pathsOk] = await Promise.all([purgeWorkersCache({ tags: purgeTags }), purgeWorkersCache({ pathPrefixes })]);
	return r2Ok && tagsOk && pathsOk;
}

/** 講者或演講-講者關聯更新後，刪除 R2 origin 並 purge Workers Cache */
async function invalidateSpeakerCaches(c: Context<ApiEnv>, speakerRoutePathnames: string[]): Promise<boolean> {
	const host = new URL(c.req.url).host;
	const pathPrefixes: string[] = [];

	for (const routePathname of speakerRoutePathnames) {
		// Request path is percent-encoded; skip raw Unicode prefixes.
		pathPrefixes.push(speakerRequestPath(routePathname));
	}

	const { r2Keys, tags: purgeTags } = planSpeakerInvalidation(host, speakerRoutePathnames);

	const r2Results = await Promise.all(r2Keys.map((key) => deleteR2Cache(c.env.SPEECH_CACHE, key)));
	const r2Ok = r2Results.every(Boolean);
	if (!r2Ok) {
		console.error('[invalidate] speaker R2 origin delete incomplete', {
			failed: r2Results.filter((ok) => !ok).length,
		});
	}
	const tagsOk = await purgeWorkersCache({ tags: purgeTags });
	const pathsOk = pathPrefixes.length > 0 ? await purgeWorkersCache({ pathPrefixes }) : true;
	return r2Ok && tagsOk && pathsOk;
}

/** 失效列表頁快取（home/speeches/speakers 三者皆清）：tags only for exact list roots; R2 origin keys still deleted */
async function invalidateListPageCaches(c: Context<ApiEnv>): Promise<boolean> {
	const host = new URL(c.req.url).host;
	const { r2Keys, tags: purgeTags } = planListInvalidation(host, true, true, true);

	const r2Results = await Promise.all(r2Keys.map((key) => deleteR2Cache(c.env.SPEECH_CACHE, key)));
	const r2Ok = r2Results.every(Boolean);
	if (!r2Ok) {
		console.error('[invalidate] list R2 origin delete incomplete', {
			failed: r2Results.filter((ok) => !ok).length,
		});
	}
	// home is always requested, so purgeTags is never empty.
	const purgeOk = await purgeWorkersCache({ tags: purgeTags });
	return r2Ok && purgeOk;
}

async function syncSearchArtifactsAfterUpsert(c: Context<ApiEnv>, filename: string): Promise<boolean> {
	const results = await Promise.allSettled([writeSearchOverlayForSpeech(c, filename), syncSearchStats(c)]);
	let ok = true;
	for (const result of results) {
		if (result.status === 'rejected') {
			ok = false;
			console.error('[upload_markdown] search upsert sync error', result.reason);
		}
	}
	return ok;
}

/** Purge search HTML/API front cache only after search artifacts are fresh. */
async function purgeSearchFrontCache(): Promise<boolean> {
	return purgeWorkersCache({ tags: [tags.listSearch] });
}

async function syncSearchArtifactsAfterDelete(c: Context<ApiEnv>, filename: string): Promise<boolean> {
	const results = await Promise.allSettled([markSpeechDeletedInSearch(c.env.SPEECH_CACHE, filename), syncSearchStats(c)]);
	let ok = true;
	for (const result of results) {
		if (result.status === 'rejected') {
			ok = false;
			console.error('[upload_markdown] search delete sync error', result.reason);
		}
	}
	return ok;
}

/** 上傳 Markdown API：支援 POST（新增）、PATCH（更新）、DELETE（刪除），需 Bearer token 驗證 */
export async function uploadMarkdown(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const corsHeadersWithMethods = {
		...corsHeaders,
		'Access-Control-Allow-Methods': corsMethods,
	};

	try {
		// 驗證：必須帶 Authorization: Bearer <token>，且 token 為允許的其中一個
		const authorized = await isAuthorizedFromHeader(
			c.req.header('Authorization'),
			c.env.AUDREYT_TRANSCRIPT_TOKEN,
			c.env.BESTIAN_TRANSCRIPT_TOKEN,
		);
		if (!authorized) {
			return c.text('Forbidden', 400, corsHeadersWithMethods);
		}

		const method = c.req.method;

		if (method === 'DELETE') {
			// DELETE：filename は query param で受け取る（CF が DELETE body を剥ぎ取るため）

			console.log('[upload_markdown] DELETE');

			const queryFilename = c.req.query('filename');
			console.log('[upload_markdown] DELETE query filename:', queryFilename);

			if (!queryFilename || typeof queryFilename !== 'string') {
				return c.json({ error: 'Missing or invalid filename query parameter' }, 400, corsHeadersWithMethods);
			}

			const inputFilename = queryFilename.trim();

			if (!inputFilename) {
				return c.json({ error: 'Filename cannot be empty' }, 400, corsHeadersWithMethods);
			}

			let filename = transformFilename(inputFilename);
			console.log('[upload_markdown] filename transform:', { input: inputFilename, output: filename });

			// 若這個 filename 已被合併到 canonical，DELETE 改打 canonical
			const canonicalFilename = await lookupRedirectTarget(c, filename);
			if (canonicalFilename) {
				console.log('[upload_markdown] DELETE redirect:', { from: filename, to: canonicalFilename });
				filename = canonicalFilename;
			}

			// 先查講者與段落 ID（刪除後 invalidate 仍需清舊 /speech/:id 快取）
			const linkedSpeakers = await withRetry(() =>
				c.env.DB.prepare('SELECT speaker_route_pathname FROM speech_speakers WHERE speech_filename = ?')
					.bind(filename)
					.all<{ speaker_route_pathname: string }>(),
			);
			const speakerRoutePathnames = Array.from(new Set(linkedSpeakers.results.map((row) => row.speaker_route_pathname).filter(Boolean)));
			const preexistingSectionRows = await withRetry(() =>
				c.env.DB.prepare('SELECT section_id FROM speech_content WHERE filename = ?').bind(filename).all<{ section_id: number }>(),
			);
			const preexistingSectionIds = preexistingSectionRows.results.map((row) => Number(row.section_id));

			// 單一 batch：刪段落 + 刪關聯 + 刪索引 + 清孤兒講者（減少 D1 round-trips）
			console.log('[upload_markdown] DELETE batch for:', filename);
			const deleteBatch: Parameters<typeof c.env.DB.batch>[0] = [
				c.env.DB.prepare('DELETE FROM speech_content WHERE filename = ?').bind(filename),
				c.env.DB.prepare('DELETE FROM speech_speakers WHERE speech_filename = ?').bind(filename),
				c.env.DB.prepare('DELETE FROM speech_index WHERE filename = ?').bind(filename),
			];
			// 用 NOT EXISTS 子查詢一次刪除孤兒講者，不需逐一查再刪
			for (const routePathname of speakerRoutePathnames) {
				deleteBatch.push(
					c.env.DB.prepare(
						'DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS (SELECT 1 FROM speech_speakers WHERE speaker_route_pathname = ?)',
					).bind(routePathname, routePathname),
				);
			}

			const batchResults = await withRetry(() => c.env.DB.batch(deleteBatch));

			const sectionsDeleted = batchResults[0].meta.changes;
			const relationsDeleted = batchResults[1].meta.changes;
			const speechDeleted = batchResults[2].meta.changes;
			let speakersDeleted = 0;
			for (let i = 3; i < batchResults.length; i++) {
				speakersDeleted += batchResults[i].meta.changes;
			}

			if (sectionsDeleted === 0 && relationsDeleted === 0 && speechDeleted === 0) {
				return c.json(
					{
						success: false,
						message: `No records found for filename: ${filename}`,
						deleted: { sections: 0, relations: 0, speakers: 0, speech: 0 },
					},
					404,
					corsHeadersWithMethods,
				);
			}

			const [cachePurge, searchSync] = await Promise.all([
				Promise.all([
					invalidateSpeechCaches(c, filename, preexistingSectionIds),
					invalidateSpeakerCaches(c, speakerRoutePathnames),
					invalidateListPageCaches(c),
				]).then((parts) => parts.every(Boolean)),
				syncSearchArtifactsAfterDelete(c, filename),
			]);
			// Only after search artifacts are fresh: evict /search/ and /api/search.json front cache.
			const searchFrontPurge = searchSync ? await purgeSearchFrontCache() : false;
			const searchFresh = searchSync && searchFrontPurge;
			if (!cachePurge || !searchFresh) {
				console.error('[upload_markdown] DELETE post-commit invalidation incomplete', {
					filename,
					cachePurge,
					searchSync,
					searchFrontPurge,
				});
			}

			return c.json(
				{
					success: true,
					cachePurge,
					searchSync: searchFresh,
					message: `Successfully deleted ${filename}`,
					deleted: {
						sections: sectionsDeleted,
						relations: relationsDeleted,
						speakers: speakersDeleted,
						speech: speechDeleted,
					},
				},
				cachePurge && searchFresh ? 200 : 503,
				corsHeadersWithMethods,
			);
		} else if (method === 'POST') {
			// POST：新增一筆演講。寫入 speech_index、speakers、speech_speakers、speech_content（段落）
			let body: { filename?: string; markdown?: string; alternate_filename?: string };
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
			let filename = transformFilename(raw_filename.trim());
			const markdown = body.markdown as string;

			if (!body.markdown || typeof body.markdown !== 'string') {
				return c.json({ error: 'Missing or invalid markdown field' }, 400, corsHeadersWithMethods);
			}

			// 從 markdown 第一行解析標題（display_name）；guard 用它判斷 key 衝突
			const firstLine = body.markdown.split('\n')[0].trim();
			const incomingTitle = firstLine.replace(/^#\s*/, '');

			// 冪等：若 speech_index 已有此 filename 則先刪除舊資料再重新寫入
			let existing = await withRetry(() =>
				c.env.DB.prepare('SELECT filename, display_name FROM speech_index WHERE filename = ?')
					.bind(filename)
					.first<{ filename: string; display_name: string }>(),
			);

			if (!existing) {
				// 若 filename 已被合併到 canonical，改 POST 到 canonical，避免重新生出重複列
				const canonicalFilename = await lookupRedirectTarget(c, filename);
				if (canonicalFilename) {
					console.log('[upload_markdown] POST redirect:', { from: filename, to: canonicalFilename });
					filename = canonicalFilename;
					existing = await withRetry(() =>
						c.env.DB.prepare('SELECT filename, display_name FROM speech_index WHERE filename = ?')
							.bind(filename)
							.first<{ filename: string; display_name: string }>(),
					);
				}
			}

			// CLOBBER GUARD: a DIFFERENT transcript already occupies this (possibly
			// truncated) key — its title differs from ours. Don't delete-then-insert
			// over it; give the incoming speech a collision-resistant key instead.
			if (existing && incomingTitle && existing.display_name !== incomingTitle) {
				const resistantKey = collisionResistantKey(raw_filename.trim());
				if (resistantKey !== filename) {
					console.warn(
						`[upload_markdown] POST key collision on "${filename}" (existing "${existing.display_name}" != incoming "${incomingTitle}"); using "${resistantKey}"`,
					);
					filename = resistantKey;
					existing = await withRetry(() =>
						c.env.DB.prepare('SELECT filename, display_name FROM speech_index WHERE filename = ?')
							.bind(filename)
							.first<{ filename: string; display_name: string }>(),
					);
				}
			}

			let priorSpeakerRoutePathnames: string[] = [];
			if (existing) {
				console.log('[upload_markdown] POST speech_index 已存在，先刪除舊資料:', filename);
				const priorSpeakerRows = await withRetry(() =>
					c.env.DB.prepare('SELECT speaker_route_pathname FROM speech_speakers WHERE speech_filename = ?')
						.bind(filename)
						.all<{ speaker_route_pathname: string }>(),
				);
				priorSpeakerRoutePathnames = Array.from(new Set(priorSpeakerRows.results.map((row) => row.speaker_route_pathname).filter(Boolean)));
				await withRetry(() =>
					c.env.DB.batch([
						c.env.DB.prepare('DELETE FROM speech_content WHERE filename = ?').bind(filename),
						c.env.DB.prepare('DELETE FROM speech_speakers WHERE speech_filename = ?').bind(filename),
						c.env.DB.prepare('DELETE FROM speech_index WHERE filename = ?').bind(filename),
					]),
				);
			}

			const display_name = incomingTitle || filename;

			const { speakers, sectionPayloads } = await parseIncomingMarkdown(markdown);
			const speakerRoutePathnames = getUniqueSpeakerRoutePathnames(speakers);
			// Atomically reserve a contiguous, collision-free block of ids.
			const baseSectionId = await reserveSectionIds(c, sectionPayloads.length);

			// 為每個段落分配連續的 section_id 與 prev/next 鏈結
			const normalized: NormalizedSection[] = sectionPayloads.map((section, idx) => {
				const section_id = baseSectionId + idx;
				const previous_section_id = idx === 0 ? null : section_id - 1;
				const next_section_id = idx === sectionPayloads.length - 1 ? null : section_id + 1;

				return {
					section_id,
					previous_section_id,
					next_section_id,
					section_speaker: section.speaker,
					section_content: section.section_content,
				};
			});

			// 1. 寫入 speech_index + speakers + relations
			const metaBatch: Parameters<typeof c.env.DB.batch>[0] = [];

			metaBatch.push(
				c.env.DB.prepare(
					'INSERT INTO speech_index (filename, display_name, isNested, nest_filenames, nest_display_names) VALUES (?, ?, 0, ?, ?)',
				).bind(filename, display_name, '', ''),
			);

			// Relations and speaker rows come only from speakers assigned to final sections.
			// Marker-only names without a section must not appear on /speakers.
			const usedSpeakerRoutePathnames = Array.from(
				new Set(normalized.map((section) => section.section_speaker).filter((value): value is string => Boolean(value && value.trim()))),
			);
			for (const routePathname of usedSpeakerRoutePathnames) {
				const speakerName = decodeURIComponent(routePathname);
				metaBatch.push(
					c.env.DB.prepare(
						'INSERT INTO speakers (route_pathname, name, photoURL) VALUES (?, ?, NULL) ON CONFLICT(route_pathname) DO NOTHING',
					).bind(routePathname, speakerName),
				);
				metaBatch.push(
					c.env.DB.prepare('INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES (?, ?)').bind(
						filename,
						routePathname,
					),
				);
			}
			// Drop orphan speaker rows after replace/reassign (prior + marker-only, not used on sections).
			const orphanCandidates = Array.from(new Set([...priorSpeakerRoutePathnames, ...speakerRoutePathnames])).filter(
				(routePathname) => !usedSpeakerRoutePathnames.includes(routePathname),
			);
			for (const routePathname of orphanCandidates) {
				metaBatch.push(
					c.env.DB.prepare(
						'DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS (SELECT 1 FROM speech_speakers WHERE speaker_route_pathname = ?)',
					).bind(routePathname, routePathname),
				);
			}

			await withRetry(() => c.env.DB.batch(metaBatch));

			// 1b. 雙向語言連結：若指定 alternate_filename，兩邊互指
			const altFilename = body.alternate_filename ? transformFilename(body.alternate_filename.trim()) : null;
			if (altFilename) {
				await withRetry(() =>
					c.env.DB.batch([
						c.env.DB.prepare('UPDATE speech_index SET alternate_filename = ? WHERE filename = ?').bind(altFilename, filename),
						c.env.DB.prepare('UPDATE speech_index SET alternate_filename = ? WHERE filename = ?').bind(filename, altFilename),
					]),
				);
			}

			// 2. 段落分批寫入（每批約 50 筆，使用多行 VALUES 減少語句數）
			const ROWS_PER_INSERT = 10;
			const INSERTS_PER_BATCH = 5; // 5 statements × 10 rows = 50 rows per batch
			const ROWS_PER_BATCH = ROWS_PER_INSERT * INSERTS_PER_BATCH;
			const cols =
				'filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content';

			for (let batchStart = 0; batchStart < normalized.length; batchStart += ROWS_PER_BATCH) {
				const batchSlice = normalized.slice(batchStart, batchStart + ROWS_PER_BATCH);
				const sectionBatch: Parameters<typeof c.env.DB.batch>[0] = [];

				for (let i = 0; i < batchSlice.length; i += ROWS_PER_INSERT) {
					const chunk = batchSlice.slice(i, i + ROWS_PER_INSERT);
					const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
					const sql = `INSERT INTO speech_content (${cols}) VALUES ${placeholders}`;
					const binds: (string | number | null)[] = [];
					for (const section of chunk) {
						binds.push(
							filename,
							null,
							null,
							section.section_id,
							section.previous_section_id,
							section.next_section_id,
							section.section_speaker,
							section.section_content,
						);
					}
					sectionBatch.push(c.env.DB.prepare(sql).bind(...binds));
				}

				await withRetry(() => c.env.DB.batch(sectionBatch));
			}

			const [cachePurge, searchSync] = await Promise.all([
				Promise.all([
					invalidateSpeechCaches(c, filename),
					...(altFilename && altFilename !== filename ? [invalidateSpeechCaches(c, altFilename)] : []),
					invalidateSpeakerCaches(c, Array.from(new Set([...speakerRoutePathnames, ...usedSpeakerRoutePathnames]))),
					invalidateListPageCaches(c),
				]).then((parts) => parts.every(Boolean)),
				syncSearchArtifactsAfterUpsert(c, filename),
			]);
			const searchFrontPurge = searchSync ? await purgeSearchFrontCache() : false;
			const searchFresh = searchSync && searchFrontPurge;
			if (!cachePurge || !searchFresh) {
				console.error('[upload_markdown] POST post-commit invalidation incomplete', {
					filename,
					cachePurge,
					searchSync,
					searchFrontPurge,
				});
			}

			return c.json(
				{
					success: true,
					cachePurge,
					searchSync: searchFresh,
					filename,
					sectionsCount: normalized.length,
					...(altFilename ? { alternate_filename: altFilename } : {}),
				},
				cachePurge && searchFresh ? 200 : 503,
				corsHeadersWithMethods,
			);
		} else if (method === 'PATCH') {
			// PATCH：更新既有演講。以 LCS 對齊舊/新段落，更新/插入/刪除 speech_content，重建講者關聯
			let body: { filename?: string; markdown?: string; alternate_filename?: string | null };
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

			let filename = transformFilename(rawFilename.trim());
			const markdown = body.markdown;
			const patchFirstLine = markdown.split('\n')[0].trim();
			const incomingTitle = patchFirstLine.replace(/^#\s*/, '');
			let existingSpeech = await withRetry(() =>
				c.env.DB.prepare('SELECT filename, display_name, alternate_filename FROM speech_index WHERE filename = ?')
					.bind(filename)
					.first<{ filename: string; display_name?: string | null; alternate_filename?: string | null }>(),
			);
			if (!existingSpeech) {
				// 若 filename 已被合併到 canonical，改 PATCH 到 canonical，避免重新生出重複列
				const canonicalFilename = await lookupRedirectTarget(c, filename);
				if (canonicalFilename) {
					console.log('[upload_markdown] PATCH redirect:', { from: filename, to: canonicalFilename });
					filename = canonicalFilename;
					existingSpeech = await withRetry(() =>
						c.env.DB.prepare('SELECT filename, display_name, alternate_filename FROM speech_index WHERE filename = ?')
							.bind(filename)
							.first<{ filename: string; display_name?: string | null; alternate_filename?: string | null }>(),
					);
				}
			}
			// CLOBBER GUARD (mirrors POST): if this (possibly truncated) key holds a
			// DIFFERENTLY-TITLED speech, it is a distinct transcript that collided on
			// the key — re-point to a collision-resistant key so we edit/create the
			// right speech instead of corrupting the incumbent.
			if (existingSpeech && incomingTitle && existingSpeech.display_name && existingSpeech.display_name !== incomingTitle) {
				const resistantKey = collisionResistantKey(rawFilename.trim());
				if (resistantKey !== filename) {
					console.warn(
						`[upload_markdown] PATCH key collision on "${filename}" (existing "${existingSpeech.display_name}" != incoming "${incomingTitle}"); using "${resistantKey}"`,
					);
					filename = resistantKey;
					existingSpeech = await withRetry(() =>
						c.env.DB.prepare('SELECT filename, display_name, alternate_filename FROM speech_index WHERE filename = ?')
							.bind(filename)
							.first<{ filename: string; display_name?: string | null; alternate_filename?: string | null }>(),
					);
				}
			}
			if (!existingSpeech) {
				// Upsert: auto-create speech_index entry so PATCH proceeds as an insert
				await withRetry(() =>
					c.env.DB.prepare(
						'INSERT INTO speech_index (filename, display_name, isNested, nest_filenames, nest_display_names) VALUES (?, ?, 0, ?, ?)',
					)
						.bind(filename, filename, '', '')
						.run(),
				);
			}
			const hasAlternateFilename = Object.prototype.hasOwnProperty.call(body, 'alternate_filename');
			let nextAlternateFilename: string | null | undefined = undefined;
			if (hasAlternateFilename) {
				const rawAlternateFilename = body.alternate_filename;
				if (rawAlternateFilename == null) {
					nextAlternateFilename = null;
				} else if (typeof rawAlternateFilename === 'string') {
					const trimmedAlternateFilename = rawAlternateFilename.trim();
					nextAlternateFilename = trimmedAlternateFilename ? transformFilename(trimmedAlternateFilename) : null;
				} else {
					return c.json({ error: 'alternate_filename must be a string or null' }, 400, corsHeadersWithMethods);
				}
			}
			if (nextAlternateFilename === filename) {
				return c.json({ error: 'alternate_filename cannot match filename' }, 400, corsHeadersWithMethods);
			}
			const currentAlternateFilename =
				typeof existingSpeech?.alternate_filename === 'string' && existingSpeech.alternate_filename.trim()
					? transformFilename(existingSpeech.alternate_filename.trim())
					: null;
			const desiredAlternateFilename = nextAlternateFilename === undefined ? currentAlternateFilename : nextAlternateFilename;

			const displayName = incomingTitle || filename;
			const oldSectionsRaw = await withRetry(() =>
				c.env.DB.prepare(
					`SELECT section_id, previous_section_id, next_section_id, section_speaker, section_content
				 FROM speech_content
				 WHERE filename = ?
				 ORDER BY section_id ASC`,
				)
					.bind(filename)
					.all<ExistingSection>(),
			);
			const oldSections = orderSectionsByLinks(
				oldSectionsRaw.results.map((row) => ({
					section_id: Number(row.section_id),
					previous_section_id: row.previous_section_id != null ? Number(row.previous_section_id) : null,
					next_section_id: row.next_section_id != null ? Number(row.next_section_id) : null,
					section_speaker: row.section_speaker ?? null,
					section_content: row.section_content ?? '',
				})),
			);
			const oldSpeakerRows = await withRetry(() =>
				c.env.DB.prepare('SELECT speaker_route_pathname FROM speech_speakers WHERE speech_filename = ?')
					.bind(filename)
					.all<{ speaker_route_pathname: string }>(),
			);
			const oldSpeakerRoutePathnames = Array.from(new Set(oldSpeakerRows.results.map((row) => row.speaker_route_pathname).filter(Boolean)));

			const { speakers, sectionPayloads } = await parseIncomingMarkdown(markdown);
			const newSpeakerRoutePathnames = getUniqueSpeakerRoutePathnames(speakers);

			// Reserve a contiguous, collision-free block of fresh ids up front.
			// sectionPayloads.length is an upper bound on how many we can need
			// (matched sections reuse their old ids); any unused reserved ids are
			// harmless gaps. The reservation is atomic, so concurrent uploads never
			// collide on the global section_id PK.
			const reservedStart = await reserveSectionIds(c, sectionPayloads.length);
			let nextFreshId = reservedStart;
			const allocateFresh = () => nextFreshId++;
			const assignedPatched: PatchAssignedSection[] =
				oldSections.length === 0
					? sectionPayloads.map((section) => ({ ...section, section_id: allocateFresh() }))
					: assignPatchedSections(oldSections, sectionPayloads, allocateFresh);

			const normalized = withSectionLinks(assignedPatched);
			// 既有段落 ID（DB 原本有的）；finalSectionIds = PATCH 後要保留的 ID（供刪除用）
			const oldSectionIds = new Set(oldSections.map((section) => section.section_id));
			const finalSectionIds = new Set(normalized.map((section) => section.section_id));

			// 收集所有 D1 寫入為 batch 一次執行（含 display_name、講者、段落、關聯、孤兒清理）
			const batchStatements: Parameters<typeof c.env.DB.batch>[0] = [];

			// 1. 更新 display_name
			batchStatements.push(
				c.env.DB.prepare('UPDATE speech_index SET display_name = ?, alternate_filename = ? WHERE filename = ?').bind(
					displayName,
					desiredAlternateFilename,
					filename,
				),
			);
			if (hasAlternateFilename && currentAlternateFilename && currentAlternateFilename !== desiredAlternateFilename) {
				batchStatements.push(
					c.env.DB.prepare('UPDATE speech_index SET alternate_filename = NULL WHERE filename = ? AND alternate_filename = ?').bind(
						currentAlternateFilename,
						filename,
					),
				);
			}
			if (hasAlternateFilename && desiredAlternateFilename) {
				batchStatements.push(
					c.env.DB.prepare('UPDATE speech_index SET alternate_filename = ? WHERE filename = ?').bind(filename, desiredAlternateFilename),
				);
			}

			// 2. Speakers upsert happens in step 5 from final section speakers only
			//    (marker-only names without a section must not appear on /speakers).

			// 3. UPDATE 既有 / INSERT 新增段落
			for (const section of normalized) {
				if (oldSectionIds.has(section.section_id)) {
					// 此 section_id 已存在 → UPDATE
					batchStatements.push(
						c.env.DB.prepare(
							`UPDATE speech_content
							 SET previous_section_id = ?,
								 next_section_id = ?,
								 section_speaker = ?,
								 section_content = ?
							 WHERE filename = ? AND section_id = ?`,
						).bind(
							section.previous_section_id,
							section.next_section_id,
							section.section_speaker,
							section.section_content,
							filename,
							section.section_id,
						),
					);
				} else {
					// 此 section_id 為新分配 → INSERT
					batchStatements.push(
						c.env.DB.prepare(
							'INSERT INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
						).bind(
							filename,
							null,
							null,
							section.section_id,
							section.previous_section_id,
							section.next_section_id,
							section.section_speaker,
							section.section_content,
						),
					);
				}
			}

			// 4. 舊有但不在最終列表的段落 → DELETE
			for (const oldSection of oldSections) {
				if (!finalSectionIds.has(oldSection.section_id)) {
					batchStatements.push(
						c.env.DB.prepare('DELETE FROM speech_content WHERE filename = ? AND section_id = ?').bind(filename, oldSection.section_id),
					);
				}
			}

			// 5. 重建演講-講者關聯：只用「段落上實際出現的講者」，單一 batch 完成（無第二階段對帳）
			const usedSpeakerRoutePathnames = Array.from(
				new Set(normalized.map((section) => section.section_speaker).filter((value): value is string => Boolean(value && value.trim()))),
			);
			// Upsert speakers that appear on final sections only
			for (const routePathname of usedSpeakerRoutePathnames) {
				const speakerName = decodeURIComponent(routePathname);
				batchStatements.push(
					c.env.DB.prepare(
						'INSERT INTO speakers (route_pathname, name, photoURL) VALUES (?, ?, NULL) ON CONFLICT(route_pathname) DO NOTHING',
					).bind(routePathname, speakerName),
				);
			}
			batchStatements.push(c.env.DB.prepare('DELETE FROM speech_speakers WHERE speech_filename = ?').bind(filename));
			for (const routePathname of usedSpeakerRoutePathnames) {
				batchStatements.push(
					c.env.DB.prepare('INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES (?, ?)').bind(
						filename,
						routePathname,
					),
				);
			}

			// 6. 清理孤兒講者（同一 batch：INSERT 後 NOT EXISTS 在 SQLite batch 內按序可見）
			const finalImpactedSpeakers = Array.from(
				new Set([...oldSpeakerRoutePathnames, ...newSpeakerRoutePathnames, ...usedSpeakerRoutePathnames]),
			);
			for (const routePathname of finalImpactedSpeakers) {
				batchStatements.push(
					c.env.DB.prepare(
						'DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS (SELECT 1 FROM speech_speakers WHERE speaker_route_pathname = ?)',
					).bind(routePathname, routePathname),
				);
			}

			await withRetry(() => c.env.DB.batch(batchStatements));

			// 失效快取：含 PATCH 前的 section IDs（已刪除的 /speech/:id 仍需 purge）
			const preexistingSectionIds = oldSections.map((section) => section.section_id);
			const [cachePurge, searchSync] = await Promise.all([
				Promise.all([
					invalidateSpeechCaches(c, filename, preexistingSectionIds),
					...Array.from(
						new Set(
							[currentAlternateFilename, desiredAlternateFilename].filter((value): value is string => Boolean(value && value !== filename)),
						),
					).map((alternateFilename) => invalidateSpeechCaches(c, alternateFilename)),
					invalidateSpeakerCaches(c, finalImpactedSpeakers),
					invalidateListPageCaches(c),
				]).then((parts) => parts.every(Boolean)),
				syncSearchArtifactsAfterUpsert(c, filename),
			]);
			const searchFrontPurge = searchSync ? await purgeSearchFrontCache() : false;
			const searchFresh = searchSync && searchFrontPurge;
			if (!cachePurge || !searchFresh) {
				console.error('[upload_markdown] PATCH post-commit invalidation incomplete', {
					filename,
					cachePurge,
					searchSync,
					searchFrontPurge,
				});
			}

			return c.json(
				{
					success: true,
					filename,
					...(hasAlternateFilename ? { alternate_filename: desiredAlternateFilename } : {}),
					sectionsCount: normalized.length,
					insertedCount: normalized.filter((section) => !oldSectionIds.has(section.section_id)).length,
					updatedCount: normalized.filter((section) => oldSectionIds.has(section.section_id)).length,
					deletedCount: oldSections.filter((section) => !finalSectionIds.has(section.section_id)).length,
					cachePurge,
					searchSync: searchFresh,
				},
				// 503 when D1 wrote but cache and/or search artifacts incomplete
				cachePurge && searchFresh ? 200 : 503,
				corsHeadersWithMethods,
			);
		} else {
			console.error('[upload_markdown] method not supported', method);
			return c.json({ error: 'Method not supported' }, 400, corsHeadersWithMethods);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[upload_markdown] error', error);
		return c.json({ error: 'Service temporarily unavailable', detail: message }, 503, { ...corsHeadersWithMethods, 'Retry-After': '2' });
	}
}
