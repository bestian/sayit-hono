import { describe, expect, it } from 'vitest';
import { reorderSections, type SectionLike } from '../src/utils/sectionUtils';

const mk = (id: number, prev: number | null, next: number | null): SectionLike => ({
	section_id: id,
	previous_section_id: prev,
	next_section_id: next,
});

describe('reorderSections fallback branches', () => {
	it('falls back to minimum id when every section has a prev in the set', () => {
		// Both sections point at each other as previous; neither starts the chain.
		const a = mk(3, 4, null);
		const b = mk(4, 3, null);
		const result = reorderSections([a, b]);
		// Fallback picks smallest id (3) as head; no next_section_id means we stop there.
		expect(result[0].section_id).toBe(3);
	});

	it('handles entirely null/undefined inputs without throwing', () => {
		// reorderSections skips null entries but still returns a valid array
		const result = reorderSections([undefined as any, undefined as any]);
		expect(result).toEqual([undefined, undefined]);
	});
});
