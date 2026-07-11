import { describe, expect, it } from 'vitest';
import { checkMonotonic, reorderSections, normalizeSections, type SectionLike } from '../src/utils/sectionUtils';

const mk = (id: number, prev: number | null, next: number | null): SectionLike => ({
	section_id: id,
	previous_section_id: prev,
	next_section_id: next,
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
		it('斷成多個片段時，未走訪到的段落依 section_id 排序附加在尾端（不遺漏任何段落）', () => {
			// A→B 是一條可從起點走到的鏈；C↔D 是另一個彼此互指的循環片段，
			// 從 A 出發永遠走不到 C/D（資料損毀情境：例如 D1 row 遺失或匯入錯誤）
			const a = mk(1, null, 2);
			const b = mk(2, 1, null);
			const c = mk(10, 20, 20); // previous/next 都指向 d
			const d = mk(20, 10, 10); // previous/next 都指向 c
			const result = reorderSections([d, b, c, a]);
			// 前段仍是正確鏈結順序；C/D 是「走訪不到」的殘餘，依 section_id 附加在尾端
			expect(result).toEqual([a, b, c, d]);
			// 結果恆為輸入的排列：不遺漏、不重複任何一筆
			expect(result.map((s) => s.section_id).sort((x, y) => x - y)).toEqual([1, 2, 10, 20]);
		});
		it('循環鏈結不會無限迴圈（visited 防禦性保護，確保 Workers CPU 時限內終止）', () => {
			// a→b→c→a 三者互相形成循環，沒有任何一筆的 previous 不在集合內，
			// 觸發 fallback：以最小 section_id 當起點，用 visited 保證走訪終止
			const a = mk(1, 3, 2);
			const b = mk(2, 1, 3);
			const c = mk(3, 2, 1);
			const result = reorderSections([c, a, b]);
			// 恆為排列（無資料遺失），且確實在有限步驟內回傳（本測試本身即是終止性證明）
			expect(result.map((s) => s.section_id).sort((x, y) => x - y)).toEqual([1, 2, 3]);
			expect(result).toHaveLength(3);
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
