import { describe, expect, it } from 'vitest';
import { getSpeakerColor, speakerColorPalette } from '../src/utils/speakerColor';

describe('getSpeakerColor', () => {
	it('exports the legacy palette', () => {
		expect(speakerColorPalette.length).toBeGreaterThan(0);
		for (const color of speakerColorPalette) {
			expect(color).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('returns the first palette entry for missing keys', () => {
		expect(getSpeakerColor()).toBe(speakerColorPalette[0]);
		expect(getSpeakerColor(null)).toBe(speakerColorPalette[0]);
		expect(getSpeakerColor('')).toBe(speakerColorPalette[0]);
	});

	it('returns a palette entry for any non-empty string', () => {
		const color = getSpeakerColor('audrey-tang');
		expect(speakerColorPalette).toContain(color);
	});

	it('returns the same color for the same key', () => {
		expect(getSpeakerColor('abc')).toBe(getSpeakerColor('abc'));
	});
});
