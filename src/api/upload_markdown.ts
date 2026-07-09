import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import { isAuthorizedFromHeader } from './auth';
import type { ApiEnv } from './types';
import { marked } from 'marked';
import {
	CACHE_KEY_VERSION,
	deleteR2Cache,
	purgeWorkersCache,
	r2AnKey,
	r2MdKey,
	r2OgSectionKey,
	r2OgSpeechKey,
	speechRequestPath,
	speakerRequestPath,
	tags
} from './cache';
import {
	markSpeechDeletedInSearch,
	syncSearchStats,
	writeSearchOverlayForSpeech
} from '../search/runtime';

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
	const row = await withRetry(() => c.env.DB.prepare(
		'SELECT new_filename FROM speech_redirects WHERE old_filename = ?'
	)
		.bind(filename)
		.first());
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

/** 從講者標記陣列取出不重複的 route_pathname（用於 DB 關聯與快取失效） */
function getUniqueSpeakerRoutePathnames(speakerMarks: SpeakerMark[]): string[] {
	return Array.from(
		new Set(
			speakerMarks
				.map((s) => s.speakerSlug)
				.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
		)
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
			c.env.DB.prepare(
				'CREATE TABLE IF NOT EXISTS section_id_counter (id INTEGER PRIMARY KEY, next_id INTEGER NOT NULL)'
			),
			c.env.DB.prepare('INSERT OR IGNORE INTO section_id_counter (id, next_id) VALUES (1, 0)')
		])
	);
	// The atomic reservation: one statement, serialised by SQLite's write lock.
	// next_id := max(current counter, MAX(section_id)+1) + n ; reserved block is
	// the n ids immediately below the returned next_id.
	const row = await withRetry(() =>
		c.env.DB.prepare(
			`UPDATE section_id_counter
			 SET next_id = MAX(next_id, (SELECT COALESCE(MAX(section_id), 0) + 1 FROM speech_content)) + ?
			 WHERE id = 1
			 RETURNING next_id`
		)
			.bind(n)
			.first<{ next_id: number | string }>()
	);
	const newNext = row != null ? Number(row.next_id) : NaN;
	if (!Number.isFinite(newNext)) {
		throw new Error('reserveSectionIds: counter update returned no row');
	}
	return newNext - n;
}

/** Markdown 轉 HTML 並移除 <script> */
function toHtml(markdown: string): string {
	const html = marked.parse(markdown);
	return stripScripts(typeof html === 'string' ? html : '');
}

/** 若第一行是 # 標題則清空，避免重複當成段落內容 */
function stripMarkdownTitleLine(markdown: string): string {
	const mdLines = markdown.split('\n');
	if (mdLines[0] && /^#\s/.test(mdLines[0].trim())) {
		mdLines[0] = '';
	}
	return mdLines.join('\n');
}

/** 段落比對鍵：用於 LCS 判斷「同一段」是否相同（講者 + 內容） */
function normalizeSectionComparableContent(input: string): string {
	return input
		// 先把常見換行型標記轉成空白，再移除其餘 HTML 標記
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<\/?p\b[^>]*>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		// Markdown link/image：保留可讀文字，移除 URL
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		// Markdown inline code
		.replace(/`([^`]+)`/g, '$1')
		// 行首 markdown 記號（標題、引用、清單）
		.replace(/^\s{0,3}#{1,6}\s+/gm, '')
		.replace(/^\s{0,3}>\s?/gm, '')
		.replace(/^\s{0,3}[-*+]\s+/gm, '')
		// decode 常見 HTML entity（避免同內容不同編碼）
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		// 斷行與多空白差異一律視為同值
		.replace(/\s+/g, ' ')
		.trim();
}

/** 偵測段落是否「以 svg / iframe 嵌入區塊為主體」；若是，回傳該標籤名 */
function detectEmbeddedMediaTag(input: string): 'svg' | 'iframe' | null {
	let detected: 'svg' | 'iframe' | null = null;
	let stripped = input;
	for (const tag of ['svg', 'iframe'] as const) {
		const re = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${tag}\\s*>`, 'gi');
		const replaced = stripped.replace(re, ' ');
		if (replaced !== stripped) {
			detected ??= tag;
			stripped = replaced;
		}
	}
	if (!detected) return null;
	// 只有「去掉媒體區塊與 HTML 標記後幾乎沒剩文字」才視為純嵌入段落，避免誤傷夾帶說明文字的段落
	const remainder = stripped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	return remainder === '' ? detected : null;
}

function sectionMatchKey(section: { markdown: string; speaker: string | null }) {
	// svg / iframe 區塊內部小幅變動（viewBox、src query）不應觸發 LCS 重排，直接以標籤類型作 key
	const mediaTag = detectEmbeddedMediaTag(section.markdown);
	if (mediaTag) {
		return `${section.speaker ?? ''}\u0000__embedded_${mediaTag}__`;
	}
	return `${section.speaker ?? ''}\u0000${normalizeSectionComparableContent(section.markdown)}`;
}

/** 依 previous/next 鏈結將 DB 取出的段落排成正確順序；找不到頭則改依 section_id 排序 */
function orderSectionsByLinks(rows: ExistingSection[]): ExistingSection[] {
	if (rows.length <= 1) return rows;
	const byId = new Map<number, ExistingSection>();
	for (const row of rows) {
		byId.set(row.section_id, row);
	}

	// 找出「頭」：previous 為 null 或不在列表內的段落
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
		const remains: ExistingSection[] = [];
		for (const row of rows) {
			if (!visited.has(row.section_id)) remains.push(row);
		}
		remains.sort((a, b) => a.section_id - b.section_id);
		ordered.push(...remains);
	}

	return ordered;
}

/** PATCH 用：以 LCS（最長共同子序列）找出舊/新段落對應的 (oldIdx, newIdx)  pairs，供 assignPatchedSections 沿用 section_id */
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

/**
 * PATCH 用：以 LCS 對齊舊/新段落，能對上的沿用舊 section_id（URL 穩定），多出來
 * 的新段落用 `allocateFresh()` 取得全域唯一的新 ID。
 *
 * allocateFresh() draws sequentially from a block pre-reserved via
 * reserveSectionIds (globalMax+1..), so every inserted id is strictly greater
 * than every existing section_id and than every other id minted this request —
 * cross-speech / intra-request UNIQUE-PK collisions are impossible by
 * construction. There is no positional `base*100+N` scheme any more: section_id
 * is pure identity and display order comes from the previous/next link chain
 * (withSectionLinks + sectionUtils), so non-local inserted ids are fine.
 */
function assignPatchedSections(
	oldRows: ExistingSection[],
	newSections: SectionPayload[],
	allocateFresh: () => number
): PatchAssignedSection[] {
	const oldSections: Array<SectionPayload & { section_id: number }> = oldRows.map((row) => ({
		section_id: row.section_id,
		markdown: row.section_content,
		speaker: row.section_speaker,
		section_content: row.section_content
	}));
	const output: PatchAssignedSection[] = [];
	let oldCursor = 0;
	let newCursor = 0;

	const emit = (section: SectionPayload, sectionId: number) => {
		output.push({ ...section, section_id: sectionId });
	};

	// Special case: 改第一段（新第一段是陌生內容）時，強制沿用舊第一段 section_id
	if (
		oldSections.length > 0 &&
		newSections.length > 0 &&
		sectionMatchKey(oldSections[0]) !== sectionMatchKey(newSections[0])
	) {
		emit(newSections[0], oldSections[0].section_id);
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

		// Reuse old ids for paired sections in the gap; fresh ids for the rest.
		for (let k = 0; k < pairedCount; k += 1) emit(newGap[k], oldGap[k].section_id);
		for (let k = pairedCount; k < newGap.length; k += 1) emit(newGap[k], allocateFresh());

		emit(newSections[newMatchIdx], oldSections[oldMatchIdx].section_id);
		oldCursor = oldMatchIdx + 1;
		newCursor = newMatchIdx + 1;
	}

	const oldTail = oldSections.slice(oldCursor);
	const newTail = newSections.slice(newCursor);
	const tailPairCount = Math.min(oldTail.length, newTail.length);

	for (let k = 0; k < tailPairCount; k += 1) emit(newTail[k], oldTail[k].section_id);
	for (let k = tailPairCount; k < newTail.length; k += 1) emit(newTail[k], allocateFresh());

	return output;
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
			section_content: toHtml(section.markdown)
		}))
	};
}

/** 為已分配 section_id 的段落補上 previous_section_id / next_section_id 鏈結 */
function withSectionLinks(sections: PatchAssignedSection[]): NormalizedSection[] {
	return sections.map((section, idx) => ({
		section_id: section.section_id,
		previous_section_id: idx === 0 ? null : sections[idx - 1].section_id,
		next_section_id: idx === sections.length - 1 ? null : sections[idx + 1].section_id,
		section_speaker: section.speaker,
		section_content: section.section_content
	}));
}


/** 演講內容或 .an/.md 更新後，刪除 R2 origin 並 purge Workers Cache.
 *  extraSectionIds: section IDs that may no longer exist in D1 (deleted/reassigned on PATCH/DELETE)
 *  but still need R2 + Workers Cache purge for /speech/:id pages.
 */
async function invalidateSpeechCaches(
	c: Context<ApiEnv>,
	filename: string,
	extraSectionIds: Iterable<number> = []
) {
	const host = new URL(c.req.url).host;
	const encodedFilename = encodeURIComponent(filename);
	const r2Keys = [
		r2AnKey(filename),
		r2MdKey(filename),
		`${CACHE_KEY_VERSION}/${host}/${filename}`,
		`${CACHE_KEY_VERSION}/${host}/${encodedFilename}`,
		r2OgSpeechKey(filename),
	];
	// pathPrefixes: request-path encoding only (percent-encoded). Raw Unicode prefixes can fail purge.
	// List roots use tags only — never pathPrefix '/'.
	const pathPrefixes = [speechRequestPath(filename)];
	const sectionIds = new Set<number>();
	for (const id of extraSectionIds) {
		if (Number.isFinite(id)) sectionIds.add(Number(id));
	}

	try {
		const result = await c.env.DB.prepare(
			'SELECT section_id FROM speech_content WHERE filename = ?'
		).bind(filename).all();
		for (const row of result.results as Array<{ section_id: number }>) {
			sectionIds.add(Number(row.section_id));
		}
	} catch (err) {
		console.error('[invalidate] section query error', err);
	}

	for (const sectionId of sectionIds) {
		r2Keys.push(`${CACHE_KEY_VERSION}/${host}/speech/${sectionId}`);
		r2Keys.push(r2OgSectionKey(sectionId));
		pathPrefixes.push(`/speech/${sectionId}`);
	}

	const purgeTags = [tags.speech(filename), tags.listHome, tags.listSpeeches, tags.listRss];
	// Split tags vs pathPrefixes so a bad prefix cannot block tag purge.
	await Promise.allSettled([
		...r2Keys.map((key) => deleteR2Cache(c.env.SPEECH_CACHE, key)),
		purgeWorkersCache({ tags: purgeTags }),
		purgeWorkersCache({ pathPrefixes }),
	]);
}

/** 講者或演講-講者關聯更新後，刪除 R2 origin 並 purge Workers Cache */
async function invalidateSpeakerCaches(c: Context<ApiEnv>, speakerRoutePathnames: string[]) {
	const host = new URL(c.req.url).host;
	const r2Keys = new Set<string>([`${CACHE_KEY_VERSION}/${host}/speakers`]);
	const pathPrefixes: string[] = [];

	for (const routePathname of speakerRoutePathnames) {
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speaker/${routePathname}`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speaker/${encodeURIComponent(routePathname)}`);
		// Request path is percent-encoded; skip raw Unicode prefixes.
		pathPrefixes.push(speakerRequestPath(routePathname));
	}

	const purgeTags = speakerRoutePathnames.map((p) => tags.speaker(p));
	purgeTags.push(tags.listSpeakers);

	await Promise.allSettled([
		...Array.from(r2Keys).map((key) => deleteR2Cache(c.env.SPEECH_CACHE, key)),
		purgeWorkersCache({ tags: purgeTags }),
		...(pathPrefixes.length > 0 ? [purgeWorkersCache({ pathPrefixes })] : []),
	]);
}

/** 失效列表頁快取：tags only for exact list roots; R2 origin keys still deleted */
async function invalidateListPageCaches(
	c: Context<ApiEnv>,
	{ home, speeches, speakers }: { home: boolean; speeches: boolean; speakers: boolean }
) {
	const host = new URL(c.req.url).host;
	const r2Keys = new Set<string>();

	if (home) {
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/index.html`);
	}
	if (speeches) {
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speeches`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speeches/`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/rss.xml`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/feed.xml`);
	}
	if (speakers) {
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speakers`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speakers/`);
	}

	const purgeTags: string[] = [];
	if (home) purgeTags.push(tags.listHome);
	if (speeches) purgeTags.push(tags.listSpeeches, tags.listRss);
	if (speakers) purgeTags.push(tags.listSpeakers);

	await Promise.allSettled([
		...Array.from(r2Keys).map((key) => deleteR2Cache(c.env.SPEECH_CACHE, key)),
		...(purgeTags.length > 0 ? [purgeWorkersCache({ tags: purgeTags })] : []),
	]);
}

async function syncSearchArtifactsAfterUpsert(c: Context<ApiEnv>, filename: string) {
	const results = await Promise.allSettled([
		writeSearchOverlayForSpeech(c, filename),
		syncSearchStats(c)
	]);
	for (const result of results) {
		if (result.status === 'rejected') {
			console.error('[upload_markdown] search upsert sync error', result.reason);
		}
	}
}

async function syncSearchArtifactsAfterDelete(c: Context<ApiEnv>, filename: string) {
	const results = await Promise.allSettled([
		markSpeechDeletedInSearch(c.env.SPEECH_CACHE, filename),
		syncSearchStats(c)
	]);
	for (const result of results) {
		if (result.status === 'rejected') {
			console.error('[upload_markdown] search delete sync error', result.reason);
		}
	}
}

/** 上傳 Markdown API：支援 POST（新增）、PATCH（更新）、DELETE（刪除），需 Bearer token 驗證 */
export async function uploadMarkdown(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const corsHeadersWithMethods = {
		...corsHeaders,
		'Access-Control-Allow-Methods': corsMethods
	};

	try {
		// 驗證：必須帶 Authorization: Bearer <token>，且 token 為允許的其中一個
		const authorized = await isAuthorizedFromHeader(
			c.req.header('Authorization'),
			c.env.AUDREYT_TRANSCRIPT_TOKEN,
			c.env.BESTIAN_TRANSCRIPT_TOKEN
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
				const linkedSpeakers = await withRetry(() => c.env.DB.prepare(
					'SELECT speaker_route_pathname FROM speech_speakers WHERE speech_filename = ?'
				)
					.bind(filename)
					.all<{ speaker_route_pathname: string }>());
				const speakerRoutePathnames = Array.from(
					new Set((linkedSpeakers.results ?? []).map((row) => row.speaker_route_pathname).filter(Boolean))
				);
				const preexistingSectionRows = await withRetry(() => c.env.DB.prepare(
					'SELECT section_id FROM speech_content WHERE filename = ?'
				)
					.bind(filename)
					.all<{ section_id: number }>());
				const preexistingSectionIds = (preexistingSectionRows.results ?? []).map((row) => Number(row.section_id));

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
							'DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS (SELECT 1 FROM speech_speakers WHERE speaker_route_pathname = ?)'
						).bind(routePathname, routePathname)
					);
				}

				const batchResults = await withRetry(() => c.env.DB.batch(deleteBatch));

				const sectionsDeleted = batchResults[0]?.meta?.changes ?? 0;
				const relationsDeleted = batchResults[1]?.meta?.changes ?? 0;
				const speechDeleted = batchResults[2]?.meta?.changes ?? 0;
				let speakersDeleted = 0;
				for (let i = 3; i < batchResults.length; i++) {
					speakersDeleted += batchResults[i]?.meta?.changes ?? 0;
				}

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

				await invalidateSpeechCaches(c, filename, preexistingSectionIds);
				await invalidateSpeakerCaches(c, speakerRoutePathnames);
				await invalidateListPageCaches(c, { home: true, speeches: true, speakers: true });
				await syncSearchArtifactsAfterDelete(c, filename);

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
			const firstLine = body.markdown.split('\n')[0]?.trim() ?? '';
			const incomingTitle = firstLine.replace(/^#\s*/, '');

			// 冪等：若 speech_index 已有此 filename 則先刪除舊資料再重新寫入
			let existing = await withRetry(() => c.env.DB.prepare(
				'SELECT filename, display_name FROM speech_index WHERE filename = ?'
			)
				.bind(filename)
				.first<{ filename: string; display_name: string }>());

			if (!existing) {
				// 若 filename 已被合併到 canonical，改 POST 到 canonical，避免重新生出重複列
				const canonicalFilename = await lookupRedirectTarget(c, filename);
				if (canonicalFilename) {
					console.log('[upload_markdown] POST redirect:', { from: filename, to: canonicalFilename });
					filename = canonicalFilename;
					existing = await withRetry(() => c.env.DB.prepare(
						'SELECT filename, display_name FROM speech_index WHERE filename = ?'
					)
						.bind(filename)
						.first<{ filename: string; display_name: string }>());
				}
			}

			// CLOBBER GUARD: a DIFFERENT transcript already occupies this (possibly
			// truncated) key — its title differs from ours. Don't delete-then-insert
			// over it; give the incoming speech a collision-resistant key instead.
			if (existing && incomingTitle && existing.display_name !== incomingTitle) {
				const resistantKey = collisionResistantKey(raw_filename.trim());
				if (resistantKey !== filename) {
					console.warn(
						`[upload_markdown] POST key collision on "${filename}" (existing "${existing.display_name}" != incoming "${incomingTitle}"); using "${resistantKey}"`
					);
					filename = resistantKey;
					existing = await withRetry(() => c.env.DB.prepare(
						'SELECT filename, display_name FROM speech_index WHERE filename = ?'
					)
						.bind(filename)
						.first<{ filename: string; display_name: string }>());
				}
			}

			if (existing) {
				console.log('[upload_markdown] POST speech_index 已存在，先刪除舊資料:', filename);
				await withRetry(() => c.env.DB.batch([
					c.env.DB.prepare('DELETE FROM speech_content WHERE filename = ?').bind(filename),
					c.env.DB.prepare('DELETE FROM speech_speakers WHERE speech_filename = ?').bind(filename),
					c.env.DB.prepare('DELETE FROM speech_index WHERE filename = ?').bind(filename),
				]));
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
					section_content: section.section_content
				};
			});

			// 1. 寫入 speech_index + speakers + relations
			const metaBatch: Parameters<typeof c.env.DB.batch>[0] = [];

			metaBatch.push(
				c.env.DB.prepare(
					'INSERT INTO speech_index (filename, display_name, isNested, nest_filenames, nest_display_names) VALUES (?, ?, 0, ?, ?)'
				).bind(filename, display_name, '', '')
			);

			for (const routePathname of speakerRoutePathnames) {
				const speakerName = decodeURIComponent(routePathname);
				metaBatch.push(
					c.env.DB.prepare(
						'INSERT INTO speakers (route_pathname, name, photoURL) VALUES (?, ?, NULL) ON CONFLICT(route_pathname) DO NOTHING'
					).bind(routePathname, speakerName)
				);
				metaBatch.push(
					c.env.DB.prepare(
						'INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES (?, ?)'
					).bind(filename, routePathname)
				);
			}

			await withRetry(() => c.env.DB.batch(metaBatch));

			// 1b. 雙向語言連結：若指定 alternate_filename，兩邊互指
			const altFilename = body.alternate_filename
				? transformFilename(body.alternate_filename.trim())
				: null;
			if (altFilename) {
				await withRetry(() =>
					c.env.DB.batch([
						c.env.DB.prepare('UPDATE speech_index SET alternate_filename = ? WHERE filename = ?').bind(altFilename, filename),
						c.env.DB.prepare('UPDATE speech_index SET alternate_filename = ? WHERE filename = ?').bind(filename, altFilename),
					])
				);
			}

			// 2. 段落分批寫入（每批約 50 筆，使用多行 VALUES 減少語句數）
			const ROWS_PER_INSERT = 10;
			const INSERTS_PER_BATCH = 5; // 5 statements × 10 rows = 50 rows per batch
			const ROWS_PER_BATCH = ROWS_PER_INSERT * INSERTS_PER_BATCH;
			const cols = 'filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content';

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
							section.section_content
						);
					}
					sectionBatch.push(c.env.DB.prepare(sql).bind(...binds));
				}

				await withRetry(() => c.env.DB.batch(sectionBatch));
			}

			await invalidateSpeechCaches(c, filename);
			if (altFilename && altFilename !== filename) {
				await invalidateSpeechCaches(c, altFilename);
			}
			await invalidateSpeakerCaches(c, speakerRoutePathnames);
			await invalidateListPageCaches(c, { home: true, speeches: true, speakers: true });
			await syncSearchArtifactsAfterUpsert(c, filename);

			return c.json(
				{ success: true, filename, sectionsCount: normalized.length, ...(altFilename ? { alternate_filename: altFilename } : {}) },
				200,
				corsHeadersWithMethods
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
			const patchFirstLine = markdown.split('\n')[0]?.trim() ?? '';
			const incomingTitle = patchFirstLine.replace(/^#\s*/, '');
			let existingSpeech = await withRetry(() => c.env.DB.prepare(
				'SELECT filename, display_name, alternate_filename FROM speech_index WHERE filename = ?'
			)
				.bind(filename)
				.first<{ filename: string; display_name?: string | null; alternate_filename?: string | null }>());
			if (!existingSpeech) {
				// 若 filename 已被合併到 canonical，改 PATCH 到 canonical，避免重新生出重複列
				const canonicalFilename = await lookupRedirectTarget(c, filename);
				if (canonicalFilename) {
					console.log('[upload_markdown] PATCH redirect:', { from: filename, to: canonicalFilename });
					filename = canonicalFilename;
					existingSpeech = await withRetry(() => c.env.DB.prepare(
						'SELECT filename, display_name, alternate_filename FROM speech_index WHERE filename = ?'
					)
						.bind(filename)
						.first<{ filename: string; display_name?: string | null; alternate_filename?: string | null }>());
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
						`[upload_markdown] PATCH key collision on "${filename}" (existing "${existingSpeech.display_name}" != incoming "${incomingTitle}"); using "${resistantKey}"`
					);
					filename = resistantKey;
					existingSpeech = await withRetry(() => c.env.DB.prepare(
						'SELECT filename, display_name, alternate_filename FROM speech_index WHERE filename = ?'
					)
						.bind(filename)
						.first<{ filename: string; display_name?: string | null; alternate_filename?: string | null }>());
				}
			}
			if (!existingSpeech) {
				// Upsert: auto-create speech_index entry so PATCH proceeds as an insert
				await withRetry(() => c.env.DB.prepare(
					'INSERT INTO speech_index (filename, display_name, isNested, nest_filenames, nest_display_names) VALUES (?, ?, 0, ?, ?)'
				).bind(filename, filename, '', '').run());
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
			const desiredAlternateFilename =
				nextAlternateFilename === undefined ? currentAlternateFilename : nextAlternateFilename;

			const displayName = incomingTitle || filename;
			const oldSectionsRaw = await withRetry(() => c.env.DB.prepare(
				`SELECT section_id, previous_section_id, next_section_id, section_speaker, section_content
				 FROM speech_content
				 WHERE filename = ?
				 ORDER BY section_id ASC`
			)
				.bind(filename)
				.all<ExistingSection>());
			const oldSections = orderSectionsByLinks(
				(oldSectionsRaw.results ?? []).map((row) => ({
					section_id: Number(row.section_id),
					previous_section_id: row.previous_section_id != null ? Number(row.previous_section_id) : null,
					next_section_id: row.next_section_id != null ? Number(row.next_section_id) : null,
					section_speaker: row.section_speaker ?? null,
					section_content: row.section_content ?? ''
				}))
			);
			const oldSpeakerRows = await withRetry(() => c.env.DB.prepare(
				'SELECT speaker_route_pathname FROM speech_speakers WHERE speech_filename = ?'
			)
				.bind(filename)
				.all<{ speaker_route_pathname: string }>());
			const oldSpeakerRoutePathnames = Array.from(
				new Set((oldSpeakerRows.results ?? []).map((row) => row.speaker_route_pathname).filter(Boolean))
			);

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
			const impactedSpeakers = Array.from(new Set([...oldSpeakerRoutePathnames, ...newSpeakerRoutePathnames]));

			// 收集所有 D1 寫入為 batch 一次執行（含 display_name、講者、段落、關聯、孤兒清理）
			const batchStatements: Parameters<typeof c.env.DB.batch>[0] = [];

			// 1. 更新 display_name
			batchStatements.push(
				c.env.DB.prepare('UPDATE speech_index SET display_name = ?, alternate_filename = ? WHERE filename = ?')
					.bind(displayName, desiredAlternateFilename, filename)
			);
			if (hasAlternateFilename && currentAlternateFilename && currentAlternateFilename !== desiredAlternateFilename) {
				batchStatements.push(
					c.env.DB.prepare(
						'UPDATE speech_index SET alternate_filename = NULL WHERE filename = ? AND alternate_filename = ?'
					).bind(currentAlternateFilename, filename)
				);
			}
			if (hasAlternateFilename && desiredAlternateFilename) {
				batchStatements.push(
					c.env.DB.prepare('UPDATE speech_index SET alternate_filename = ? WHERE filename = ?')
						.bind(filename, desiredAlternateFilename)
				);
			}

			// 2. 確保講者存在（冪等 upsert）
			for (const routePathname of newSpeakerRoutePathnames) {
				const speakerName = decodeURIComponent(routePathname);
				batchStatements.push(
					c.env.DB.prepare(
						'INSERT INTO speakers (route_pathname, name, photoURL) VALUES (?, ?, NULL) ON CONFLICT(route_pathname) DO NOTHING'
					).bind(routePathname, speakerName)
				);
			}

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
							 WHERE filename = ? AND section_id = ?`
						).bind(
							section.previous_section_id,
							section.next_section_id,
							section.section_speaker,
							section.section_content,
							filename,
							section.section_id
						)
					);
				} else {
					// 此 section_id 為新分配 → INSERT
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

			// 4. 舊有但不在最終列表的段落 → DELETE
			for (const oldSection of oldSections) {
				if (!finalSectionIds.has(oldSection.section_id)) {
					batchStatements.push(
						c.env.DB.prepare('DELETE FROM speech_content WHERE filename = ? AND section_id = ?')
							.bind(filename, oldSection.section_id)
					);
				}
			}

			// 5. 重建演講-講者關聯
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

			// 6. 清理孤兒講者
			for (const routePathname of impactedSpeakers) {
				batchStatements.push(
					c.env.DB.prepare(
						'DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS (SELECT 1 FROM speech_speakers WHERE speaker_route_pathname = ?)'
					).bind(routePathname, routePathname)
				);
			}

			await withRetry(() => c.env.DB.batch(batchStatements));

			// PATCH 完成後再對帳一次：僅保留「有實際段落」的演講-講者關聯
			const relationRows = await withRetry(() => c.env.DB.prepare(
				'SELECT speaker_route_pathname FROM speech_speakers WHERE speech_filename = ?'
			)
				.bind(filename)
				.all<{ speaker_route_pathname: string }>());
			const relationRoutePathnames = Array.from(
				new Set((relationRows.results ?? []).map((row) => row.speaker_route_pathname).filter(Boolean))
			);

			const usedSpeakerRows = await withRetry(() => c.env.DB.prepare(
				`SELECT DISTINCT section_speaker
				 FROM speech_content
				 WHERE filename = ?
				   AND section_speaker IS NOT NULL
				   AND section_speaker != ''`
			)
				.bind(filename)
				.all<{ section_speaker: string }>());
			const usedSpeakerRoutePathnames = new Set(
				(usedSpeakerRows.results ?? []).map((row) => row.section_speaker).filter(Boolean)
			);
			const relationsToDelete = relationRoutePathnames.filter(
				(routePathname) => !usedSpeakerRoutePathnames.has(routePathname)
			);

			// 一次 batch 刪除多餘關聯 + 孤兒講者
			const finalImpactedSpeakers = Array.from(new Set([...impactedSpeakers, ...relationsToDelete]));
			if (relationsToDelete.length > 0 || finalImpactedSpeakers.length > 0) {
				const cleanupBatch: Parameters<typeof c.env.DB.batch>[0] = [];
				for (const routePathname of relationsToDelete) {
					cleanupBatch.push(
						c.env.DB.prepare(
							'DELETE FROM speech_speakers WHERE speech_filename = ? AND speaker_route_pathname = ?'
						).bind(filename, routePathname)
					);
				}
				for (const routePathname of finalImpactedSpeakers) {
					cleanupBatch.push(
						c.env.DB.prepare(
							'DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS (SELECT 1 FROM speech_speakers WHERE speaker_route_pathname = ?)'
						).bind(routePathname, routePathname)
					);
				}
				await withRetry(() => c.env.DB.batch(cleanupBatch));
			}

			// 失效快取：含 PATCH 前的 section IDs（已刪除的 /speech/:id 仍需 purge）
			const preexistingSectionIds = oldSections.map((section) => section.section_id);
			await invalidateSpeechCaches(c, filename, preexistingSectionIds);
			const affectedAlternateFilenames = Array.from(
				new Set([currentAlternateFilename, desiredAlternateFilename].filter((value): value is string => Boolean(value && value !== filename)))
			);
			for (const alternateFilename of affectedAlternateFilenames) {
				await invalidateSpeechCaches(c, alternateFilename);
			}
			await invalidateSpeakerCaches(c, finalImpactedSpeakers);
			await invalidateListPageCaches(c, { home: true, speeches: true, speakers: true });
			await syncSearchArtifactsAfterUpsert(c, filename);

			return c.json(
				{
					success: true,
					filename,
					...(hasAlternateFilename ? { alternate_filename: desiredAlternateFilename } : {}),
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
		const message = error instanceof Error ? error.message : String(error);
		console.error('[upload_markdown] error', error);
		return c.json(
			{ error: 'Service temporarily unavailable', detail: message },
			503,
			{ ...corsHeadersWithMethods, 'Retry-After': '2' }
		);
	}
}
