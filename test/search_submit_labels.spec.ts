import { describe, expect, it } from 'vite-plus/test';

const viewSources = import.meta.glob<string>('../src/views/*.vue', {
	eager: true,
	query: '?raw',
	import: 'default',
});

const PAGEFIND_SUBMIT_RE = /<button\b[^>]*\bsayit-search__submit\b[^>]*>([\s\S]*?)<\/button>/gi;
const SITE_SEARCH_SUBMIT_RE = /<button\b[^>]*\bsite-search__submit\b[^>]*>([\s\S]*?)<\/button>/gi;
const ICON_SEARCH_SUBMIT_CONTROL_RE = /<(?:input|button)\b(?=[^>]*\btype="submit")(?=[^>]*\bclass="[^"]*icon-search)[^>]*>/gi;

function expectBilingualSearchLabel(path: string, markup: string) {
	expect(markup, `${path}: search action must show the 華文 label`).toContain('<span lang="zh">搜尋</span>');
	expect(markup, `${path}: search action must show the English label`).toContain('<span lang="en">Search</span>');
	expect(markup, `${path}: search action must not use decorative emoji`).not.toContain('✨');
	expect(markup, `${path}: search action must not use an inline icon`).not.toMatch(/<svg\b/i);
}

describe('search submit button markup in view sources', () => {
	it('uses visible bilingual text instead of decorative icons', () => {
		const entries = Object.entries(viewSources).filter(([, source]) => source.includes('sayit-search__submit'));
		expect(entries.length).toBeGreaterThan(0);

		for (const [path, source] of entries) {
			const matches = [...source.matchAll(PAGEFIND_SUBMIT_RE)];
			expect(matches.length, `${path}: expected at least one submit button`).toBeGreaterThan(0);
			for (const match of matches) expectBilingualSearchLabel(path, match[1]);
		}
	});
});

describe('search submit markup for site-search forms in view sources', () => {
	it('uses the same bilingual text contract without legacy icon classes', () => {
		const entries = Object.entries(viewSources).filter(([, source]) => source.includes('site-search') && source.includes('search-wrapper'));
		expect(entries.length).toBeGreaterThan(0);

		for (const [path, source] of entries) {
			expect(source, `${path}: submit control must not use class containing icon-search`).not.toMatch(ICON_SEARCH_SUBMIT_CONTROL_RE);
			const matches = [...source.matchAll(SITE_SEARCH_SUBMIT_RE)];
			expect(matches.length, `${path}: expected at least one site-search submit button`).toBeGreaterThan(0);
			for (const match of matches) expectBilingualSearchLabel(path, match[1]);
		}
	});
});
