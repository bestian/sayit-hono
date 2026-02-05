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
		it('嚴格遞增為 true', () => {
			expect(checkMonotonic([mk(1, null, 2), mk(2, 1, 3), mk(3, 2, null)])).toBe(true);
		});
		it('非嚴格遞增為 false', () => {
			expect(checkMonotonic([mk(1, null, 2), mk(1, 1, 3)])).toBe(false);
			expect(checkMonotonic([mk(2, null, 3), mk(1, 2, null)])).toBe(false);
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
		it('已 monotonic 則不重排', () => {
			const ordered = [mk(1, null, 2), mk(2, 1, null)];
			expect(normalizeSections(ordered)).toBe(ordered);
		});
		it('非 monotonic 則重排', () => {
			const disordered = [mk(2, 1, null), mk(1, null, 2)];
			expect(normalizeSections(disordered)).toEqual([mk(1, null, 2), mk(2, 1, null)]);
		});
		it('allowReorder=false 時不重排', () => {
			const disordered = [mk(2, 1, null), mk(1, null, 2)];
			expect(normalizeSections(disordered, false)).toBe(disordered);
		});
	});
});
