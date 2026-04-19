import { describe, expect, it } from 'vitest';
import { buildPaginationPages } from '../src/utils/pagination';

describe('buildPaginationPages', () => {
	it('lists every page when total <= 7', () => {
		expect(buildPaginationPages(1, 1)).toEqual([1]);
		expect(buildPaginationPages(3, 5)).toEqual([1, 2, 3, 4, 5]);
		expect(buildPaginationPages(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it('uses ellipsis only on the right when current is near the start', () => {
		expect(buildPaginationPages(1, 10)).toEqual([1, 2, 'ellipsis', 9, 10]);
		expect(buildPaginationPages(2, 10)).toEqual([1, 2, 3, 'ellipsis', 9, 10]);
	});

	it('uses ellipsis only on the left when current is near the end', () => {
		expect(buildPaginationPages(10, 10)).toEqual([1, 'ellipsis', 9, 10]);
		expect(buildPaginationPages(9, 10)).toEqual([1, 'ellipsis', 8, 9, 10]);
	});

	it('uses ellipsis on both sides when current is in the middle', () => {
		expect(buildPaginationPages(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 9, 10]);
	});

	it('deduplicates adjacent ranges without extra ellipsis', () => {
		expect(buildPaginationPages(3, 9)).toEqual([1, 2, 3, 4, 'ellipsis', 8, 9]);
		expect(buildPaginationPages(7, 9)).toEqual([1, 'ellipsis', 6, 7, 8, 9]);
	});
});
