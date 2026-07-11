import { describe, expect, it } from 'vite-plus/test';
import { docsFromSections, docsFromMarkdown, extractDate, stripHtml, type ApiSection } from '../src/search/docBuilder';

describe('search/docBuilder', () => {
	describe('extractDate', () => {
		it('returns the leading YYYY-MM-DD when present', () => {
			expect(extractDate('2026-03-24 Demo Speech')).toBe('2026-03-24');
		});
		it('returns empty string when no date prefix', () => {
			expect(extractDate('No date here')).toBe('');
		});
	});

	describe('stripHtml', () => {
		it('removes tags, scripts, styles, and decodes entities', () => {
			const input = '<style>x</style><script>y</script><p>Hello&nbsp;<b>world</b></p>';
			expect(stripHtml(input)).toBe('Hello world');
		});
		it('decodes numeric and hex entities', () => {
			expect(stripHtml('A&#39;B&#x26;C')).toBe("A'B&C");
		});
		it('leaves broken numeric entities untouched', () => {
			expect(stripHtml('A&#9999999999999999;B')).toContain('A');
		});
	});

	describe('docsFromSections', () => {
		const baseUrl = '/2026-03-24-demo';
		const section = (overrides: Partial<ApiSection> = {}): ApiSection => ({
			filename: '2026-03-24-demo',
			nest_filename: null,
			section_id: 1,
			section_content: '<p>Hi</p>',
			display_name: '2026-03-24 Demo Speech',
			name: 'Audrey',
			...overrides,
		});

		it('returns a single doc for flat speeches', () => {
			const docs = docsFromSections([section(), section({ section_id: 2, name: 'Bestian' })], baseUrl);
			expect(docs).toHaveLength(1);
			expect(docs[0].pageUrl).toBe(baseUrl);
			expect(docs[0].speaker).toBe('Audrey, Bestian');
			expect(docs[0].content).toContain('Audrey: Hi');
		});

		it('splits nested filename groups into separate docs with encoded URLs', () => {
			const docs = docsFromSections(
				[section({ nest_filename: 'part-1', section_id: 10 }), section({ nest_filename: 'part-2', section_id: 20, name: 'Bestian' })],
				baseUrl,
			);
			expect(docs.map((d) => d.pageUrl)).toEqual([`${baseUrl}/part-1`, `${baseUrl}/part-2`]);
			expect(docs[0].speaker).toBe('Audrey');
			expect(docs[1].speaker).toBe('Bestian');
		});

		it('drops groups with no meaningful content', () => {
			const docs = docsFromSections([section({ section_content: '   ' })], baseUrl);
			expect(docs).toEqual([]);
		});

		it('summarizes more than limit speakers with "+N more"', () => {
			const sections = [1, 2, 3, 4, 5].map((i) => section({ section_id: i, name: `Speaker${i}` }));
			const docs = docsFromSections(sections, baseUrl);
			expect(docs[0].speaker).toBe('Speaker1, Speaker2, Speaker3, +2 more');
		});

		it('truncates content beyond the excerpt maximum', () => {
			const big = 'A'.repeat(500);
			const docs = docsFromSections([section({ section_content: big })], baseUrl);
			expect(docs[0].content.length).toBeLessThan(500);
			expect(docs[0].content.endsWith('...')).toBe(true);
		});

		it('returns [] for empty sections', () => {
			expect(docsFromSections([], baseUrl)).toEqual([]);
		});
	});

	describe('docsFromMarkdown', () => {
		it('returns [] when first line is empty (no title)', () => {
			expect(docsFromMarkdown('', '/p', 'p')).toEqual([]);
			expect(docsFromMarkdown('\nnot titled', '/p', 'p')).toEqual([]);
		});

		it('splits by speaker headings and summarizes speakers', () => {
			const md = ['# Title', '## Audrey:', 'Hello.', '', '## Bestian:', 'Hi back.'].join('\n');
			const docs = docsFromMarkdown(md, '/p', 'p');
			expect(docs).toHaveLength(1);
			expect(docs[0].title).toBe('Title');
			expect(docs[0].speaker).toBe('Audrey, Bestian');
			expect(docs[0].content).toContain('Audrey: Hello.');
			expect(docs[0].content).toContain('Bestian: Hi back.');
		});

		it('falls back to a single block when no speaker line is present', () => {
			const md = '# T\n\nSome body text.';
			const docs = docsFromMarkdown(md, '/t', 't');
			expect(docs).toHaveLength(1);
			expect(docs[0].content).toBe('Some body text.');
			expect(docs[0].speaker).toBeNull();
		});

		it('returns [] when stripped body is empty', () => {
			expect(docsFromMarkdown('# Title\n', '/t', 't')).toEqual([]);
		});
	});
});
