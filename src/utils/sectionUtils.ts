/**
 * 共用段落排序與正規化邏輯
 * - checkMonotonic: O(n) 檢查陣列順序是否已對應 previous/next 鏈結（顯示順序）
 * - reorderSections: O(n) 依 previous/next 頭尾相接重排（取代原 O(n²) 實作）
 * - normalizeSections: 若已是顯示順序則直接回傳，否則重排
 */

export interface SectionLike {
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
}

/**
 * 檢查陣列順序是否已對應 previous/next 鏈結（即「顯示順序」）。
 *
 * 注意：section_id 嚴格遞增 ≠ 顯示順序。PATCH 在既有演講中段插入新段落時，
 * 新段落的 section_id 一定比周圍既有 ID 大（sub-section id = parent*100+N 或
 * fresh id = globalMax+1），按 section_id ASC 取出時會被排到最尾端，但鏈結
 * 上它應該在中段。所以這裡要檢查的是「相鄰兩列的 next_section_id / section_id
 * 是否相連」，不是 ID 的大小關係。
 */
// not lsc-verifiable: lsc emits unresolved type param T, Infinity, != None on datatypes, in on maps with wrong element types — 18 resolution/type errors prevent Dafny verification
//@ ensures \result ==> forall(i, 0 <= i && i < sections.length - 1 ==> sections[i].next_section_id == sections[i + 1].section_id)
export function checkMonotonic<T extends SectionLike>(sections: T[]): boolean {
	if (sections.length <= 1) return true;
	for (let i = 0; i < sections.length - 1; i++) {
		//@ invariant 0 <= i && i <= sections.length - 1
		//@ decreases sections.length - 1 - i
		const curr = sections[i];
		const next = sections[i + 1];
		if (!curr || !next) return false;
		if (curr.next_section_id !== next.section_id) return false;
	}
	return true;
}

/**
 * 依 previous_section_id / next_section_id 頭尾相接重排
 * 使用 Map 達成 O(n) 複雜度，避免大量資料時 O(n²) 導致逾時
 */
// not lsc-verifiable: lsc emits unresolved type param T, Infinity, != None on datatypes, in on maps with wrong element types — 18 resolution/type errors prevent Dafny verification
//@ ensures Perm(\result, sections)
export function reorderSections<T extends SectionLike>(sections: T[]): T[] {
	if (sections.length === 0) return [];

	const byId = new Map<number, T>();
	for (const s of sections) {
		if (s != null) byId.set(s.section_id, s);
	}

	// 找起點：previous 不在集合內，或 previous 為 null
	let first: T | undefined;
	let minId = Infinity;
	for (const s of sections) {
		if (!s) continue;
		const prevInSet = s.previous_section_id != null && byId.has(s.previous_section_id);
		if (!prevInSet) {
			if (s.section_id < minId) {
				minId = s.section_id;
				first = s;
			}
		}
	}

	// 若都有 prev（循環或斷鏈），用最小 section_id 當起點
	if (!first) {
		let fallbackMin = Infinity;
		for (const s of sections) {
			if (s && s.section_id < fallbackMin) {
				fallbackMin = s.section_id;
				first = s;
			}
		}
	}
	if (!first) return sections;

	const ordered: T[] = [];
	let current: T | null = first;
	//@ decreases sections.length - ordered.length
	while (current) {
		ordered.push(current);
		const nextId: number | null = current.next_section_id;
		current = nextId != null && byId.has(nextId) ? (byId.get(nextId) as T) : null;
	}
	return ordered;
}

/**
 * 若已 monotonic 則直接回傳，否則重排
 * @param allowReorder 分頁情境下設為 false，避免因缺前段而提前停止
 */
// not lsc-verifiable: lsc emits unresolved type param T, Infinity, != None on datatypes, in on maps with wrong element types — 18 resolution/type errors prevent Dafny verification
//@ ensures !allowReorder ==> \result == rawData
//@ ensures allowReorder ==> \result == rawData || Perm(\result, rawData)
export function normalizeSections<T extends SectionLike>(
	rawData: T[],
	allowReorder = true
): T[] {
	if (!allowReorder) return rawData;
	return checkMonotonic(rawData) ? rawData : reorderSections(rawData);
}
