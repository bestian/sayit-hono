import { describe, expect, it } from 'vite-plus/test';
import { formatNumberWithCommas } from '../src/utils/formatNumber';

describe('formatNumberWithCommas', () => {
	it('returns plain digits for small numbers', () => {
		expect(formatNumberWithCommas(0)).toBe('0');
		expect(formatNumberWithCommas(42)).toBe('42');
	});
	it('inserts commas at every thousands boundary', () => {
		expect(formatNumberWithCommas(1234)).toBe('1,234');
		expect(formatNumberWithCommas(400841)).toBe('400,841');
		expect(formatNumberWithCommas(1000000)).toBe('1,000,000');
	});
	it('handles negative numbers', () => {
		expect(formatNumberWithCommas(-12345)).toBe('-12,345');
	});
});
