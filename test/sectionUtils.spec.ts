import { describe, expect, it } from 'vitest';
import {
	checkMonotonic,
	reorderSections,
	normalizeSections,
	type SectionLike
} from '../src/utils/sectionUtils';

const mk = (
	id: number,
	prev: number | null,
	next: number | null
): SectionLike => ({
	section_id: id,
	previous_section_id: prev,
	next_section_id: next
});

describe('sectionUtils', () => {
	describe('checkMonotonic', () => {
		it('空陣列或單一元素為 true', () => {
			expect(checkMonotonic([])).toBe(true);
			expect(checkMonotonic([mk(1, null, 2)])).toBe(true);
		});
		it('next/section_id 相連即為 true', () => {
			expect(checkMonotonic([mk(1, null, 2), mk(2, 1, 3), mk(3, 2, null)])).toBe(true);
		});
		it('鏈結斷裂則為 false', () => {
			expect(checkMonotonic([mk(1, null, 2), mk(1, 1, 3)])).toBe(false);
			expect(checkMonotonic([mk(2, null, 3), mk(1, 2, null)])).toBe(false);
		});
		it('稀疏陣列含 hole 時為 false（防禦性 null guard）', () => {
			const sparse = [mk(1, null, 2), undefined, mk(3, 2, null)] as unknown as SectionLike[];
			expect(checkMonotonic(sparse)).toBe(false);
		});
		it('section_id 遞增但鏈結順序不一致時為 false（PATCH 中段插入情境）', () => {
			// section_id ASC = [10, 11, 12, 99]，但鏈結順序是 10 → 11 → 99 → 12
			// 99 是後來 PATCH 插在 11 與 12 之間的新段落，section_id 大但顯示位置在中段
			const head = mk(10, null, 11);
			const second = mk(11, 10, 99);
			const inserted = mk(99, 11, 12);
			const fourth = mk(12, 99, null);
			expect(checkMonotonic([head, second, inserted, fourth])).toBe(true); // 已是鏈結順序
			expect(checkMonotonic([head, second, fourth, inserted])).toBe(false); // section_id ASC 但鏈結錯亂
		});
	});

	describe('reorderSections', () => {
		it('空陣列回傳空', () => {
			expect(reorderSections([])).toEqual([]);
		});
		it('單一元素直接回傳', () => {
			const s = mk(1, null, null);
			expect(reorderSections([s])).toEqual([s]);
		});
		it('依 next 頭尾相接重排', () => {
			const a = mk(1, null, 2);
			const b = mk(2, 1, 3);
			const c = mk(3, 2, null);
			// 故意打亂順序
			const input = [c, a, b];
			expect(reorderSections(input)).toEqual([a, b, c]);
		});
		it('partial set 也能正確重排', () => {
			const a = mk(5, 4, 6); // prev=4 不在集合內
			const b = mk(6, 5, 7);
			const c = mk(7, 6, 8);
			const input = [c, a, b];
			expect(reorderSections(input)).toEqual([a, b, c]);
		});
	});

	describe('normalizeSections', () => {
		it('已是顯示順序則不重排', () => {
			const ordered = [mk(1, null, 2), mk(2, 1, null)];
			expect(normalizeSections(ordered)).toBe(ordered);
		});
		it('非顯示順序則重排', () => {
			const disordered = [mk(2, 1, null), mk(1, null, 2)];
			expect(normalizeSections(disordered)).toEqual([mk(1, null, 2), mk(2, 1, null)]);
		});
		it('section_id ASC 但鏈結順序不一致時要重排（修復 SCSP 漏排 bug）', () => {
			// 模擬 D1 用 ORDER BY section_id ASC 撈出來的資料：
			// 中段被 PATCH 插入一個新段落 (id=99，prev=11, next=12)，按 ID 排序它跑到最後
			const head = mk(10, null, 11);
			const second = mk(11, 10, 99);
			const fourth = mk(12, 99, null);
			const inserted = mk(99, 11, 12);
			const sortedById = [head, second, fourth, inserted];
			expect(normalizeSections(sortedById)).toEqual([head, second, inserted, fourth]);
		});
		it('allowReorder=false 時不重排', () => {
			const disordered = [mk(2, 1, null), mk(1, null, 2)];
			expect(normalizeSections(disordered, false)).toBe(disordered);
		});
	});
});
