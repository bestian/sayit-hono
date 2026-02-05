/**
 * 共用段落排序與正規化邏輯
 * - checkMonotonic: O(n) 檢查 section_id 是否嚴格遞增
 * - reorderSections: O(n) 依 previous/next 頭尾相接重排（取代原 O(n²) 實作）
 * - normalizeSections: 若已 monotonic 則直接回傳，否則重排
 */

export interface SectionLike {
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
}

/**
 * 檢查 section_id 是否嚴格遞增（monotonic）
 */
export function checkMonotonic<T extends SectionLike>(sections: T[]): boolean {
	if (sections.length <= 1) return true;
	for (let i = 1; i < sections.length; i++) {
		const curr = sections[i];
		const prev = sections[i - 1];
		if (curr && prev && curr.section_id <= prev.section_id) return false;
	}
	return true;
}

/**
 * 依 previous_section_id / next_section_id 頭尾相接重排
 * 使用 Map 達成 O(n) 複雜度，避免大量資料時 O(n²) 導致逾時
 */
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
	while (current) {
		ordered.push(current);
		const nextId = current.next_section_id;
		current = nextId != null && byId.has(nextId) ? (byId.get(nextId) as T) : null;
	}
	return ordered;
}

/**
 * 若已 monotonic 則直接回傳，否則重排
 * @param allowReorder 分頁情境下設為 false，避免因缺前段而提前停止
 */
export function normalizeSections<T extends SectionLike>(
	rawData: T[],
	allowReorder = true
): T[] {
	if (!allowReorder) return rawData;
	return checkMonotonic(rawData) ? rawData : reorderSections(rawData);
}
