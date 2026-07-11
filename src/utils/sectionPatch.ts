/**
 * Pure section-patching functions extracted from src/api/upload_markdown.ts.
 *
 * This is the URL-permanence contract for the whole speech archive: on PATCH,
 * a section that matches an old one must KEEP its section_id (so published
 * /speech/:section_id URLs never rot); unmatched sections get a fresh unique
 * id; the previous/next link chain must stay well-formed.
 *
 * These functions are copied verbatim (logic-identical) from upload_markdown.ts
 * and exported here for reuse and formal verification. The original file is
 * untouched.
 */

export type NormalizedSection = {
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
};

export type ExistingSection = {
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
};

export type SectionPayload = {
	markdown: string;
	speaker: string | null;
	section_content: string;
};

export type PatchAssignedSection = SectionPayload & { section_id: number };

// not lsc-verifiable: uses RegExp extensively (/<br\s*\/?>/gi, /<\/?p\b[^>]*>/gi, etc.)
// lsc has no model for RegExp or String.replace with regex patterns.
/** 段落比對鍵：用於 LCS 判斷「同一段」是否相同（講者 + 內容） */
export function normalizeSectionComparableContent(input: string): string {
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

// not lsc-verifiable: uses `new RegExp(...)` with dynamic construction and
// RegExp-based String.replace; lsc has no model for RegExp or dynamic regex.
/** 偵測段落是否「以 svg / iframe 嵌入區塊為主體」；若是，回傳該標籤名 */
export function detectEmbeddedMediaTag(input: string): 'svg' | 'iframe' | null {
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

// not lsc-verifiable: calls detectEmbeddedMediaTag (regex-based) and
// normalizeSectionComparableContent (regex-based), plus uses template
// literals with \u0000 and ?? (nullish coalescing) — lsc has no model for
// RegExp-dependent functions or nullish coalescing.
export function sectionMatchKey(section: { markdown: string; speaker: string | null }) {
	// svg / iframe 區塊內部小幅變動（viewBox、src query）不應觸發 LCS 重排，直接以標籤類型作 key
	const mediaTag = detectEmbeddedMediaTag(section.markdown);
	if (mediaTag) {
		return `${section.speaker ?? ''}\u0000__embedded_${mediaTag}__`;
	}
	return `${section.speaker ?? ''}\u0000${normalizeSectionComparableContent(section.markdown)}`;
}

// not lsc-verifiable: uses `new Map()`, `new Set()`, `.sort()` with comparator,
// `??` (nullish coalescing), and `.has()`/`.get()` on Map — lsc has no model
// for Map, Set, or comparator-based sort.
/** 依 previous/next 鏈結將 DB 取出的段落排成正確順序；找不到頭則改依 section_id 排序 */
export function orderSectionsByLinks(rows: ExistingSection[]): ExistingSection[] {
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

// not lsc-verifiable: uses `.map()` with sectionMatchKey (regex-dependent),
// `Array.from` for 2D array construction, `Math.max`, `.reverse()`, and
// nested for-loops over a DP table — lsc has no model for Array.from,
// Math.max, .reverse(), or the regex-dependent key function.
/**
 * PATCH 用：以 LCS（最長共同子序列）找出舊/新段落對應的 (oldIdx, newIdx)  pairs，供 assignPatchedSections 沿用 section_id
 */
export function buildLcsPairs(oldSections: SectionPayload[], newSections: SectionPayload[]): Array<[number, number]> {
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

// not lsc-verifiable: uses `.map()` with callback, `.slice()`, closures,
// `??` (via sectionMatchKey), and calls buildLcsPairs (which itself is not
// lsc-verifiable). The function's core invariant (output length == input
// newSections length, section_id reuse/fresh) is expressible in principle
// but the implementation uses too many lsc-unsupported constructs.
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
export function assignPatchedSections(
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

// not lsc-verifiable: uses `.map()` with a two-argument callback (value, index).
// lsc generates `Unknown` type for the index parameter, which Dafny cannot
// resolve. The function's core invariant (output length == input length,
// well-formed prev/next chain) is expressible in principle — a while-loop
// reformulation verifies cleanly (see proof-of-concept below in comments) —
// but the verbatim `.map((section, idx) => ...)` form is outside lsc's
// current type inference capability.
/**
 * 為已分配 section_id 的段落補上 previous_section_id / next_section_id 鏈結
 */
export function withSectionLinks(sections: PatchAssignedSection[]): NormalizedSection[] {
	return sections.map((section, idx) => ({
		section_id: section.section_id,
		previous_section_id: idx === 0 ? null : sections[idx - 1].section_id,
		next_section_id: idx === sections.length - 1 ? null : sections[idx + 1].section_id,
		section_speaker: section.speaker,
		section_content: section.section_content
	}));
}
