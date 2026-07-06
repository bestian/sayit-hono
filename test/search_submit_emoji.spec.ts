import { describe, expect, it } from 'vitest';

const viewSources = import.meta.glob<string>('../src/views/*.vue', {
	eager: true,
	query: '?raw',
	import: 'default',
});

const SUBMIT_BUTTON_RE =
	/<button\b[^>]*\bsayit-search__submit\b[^>]*>([\s\S]*?)<\/button>/gi;
const ICON_SEARCH_SUBMIT_CONTROL_RE =
	/<(?:input|button)\b(?=[^>]*\btype="submit")(?=[^>]*\bclass="[^"]*icon-search)[^>]*>/gi;


describe('search submit button markup in view sources', () => {
	it('uses sparkle emoji instead of inline SVG in every sayit-search__submit button', () => {
		const entries = Object.entries(viewSources).filter(([, source]) =>
			source.includes('sayit-search__submit'),
		);
		expect(entries.length).toBeGreaterThan(0);

		for (const [path, source] of entries) {
			const matches = [...source.matchAll(SUBMIT_BUTTON_RE)];
			expect(matches.length, `${path}: expected at least one submit button`).toBeGreaterThan(0);

			for (const match of matches) {
				const openTag = match[0].slice(0, match[0].indexOf('>') + 1);
				const inner = match[1];

				expect(openTag, `${path}: submit button must keep aria-label="Search"`).toContain(
					'aria-label="Search"',
				);
				expect(inner, `${path}: submit button must show ✨`).toContain('✨');
				expect(inner, `${path}: submit button must not use inline magnifying-glass SVG`).not.toMatch(
					/<svg\b/i,
				);
			}
		}
	});
});

describe('search submit markup for site-search forms in view sources', () => {
	it('forbids icon-search on site-search submit controls and requires visible ✨ with Search label', () => {
		const entries = Object.entries(viewSources).filter(
			([, source]) =>
				source.includes('site-search') && source.includes('search-wrapper'),
		);
		expect(entries.length).toBeGreaterThan(0);

		for (const [path, source] of entries) {
			expect(
				source,
				`${path}: submit control must not use class containing icon-search`,
			).not.toMatch(ICON_SEARCH_SUBMIT_CONTROL_RE);
			expect(source, `${path}: search submit must show ✨`).toContain('✨');
			expect(source, `${path}: search submit must keep aria-label="Search"`).toContain(
				'aria-label="Search"',
			);
		}
	});
});