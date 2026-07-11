import { describe, expect, it } from 'vitest';
import { createMockEnv, dispatch } from './helpers/mockEnv';

describe('rss decodeHtmlEntities branches', () => {
	it('decodes decimal, hex, and named entities in summary', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							filename: '2026-06-10-demo',
							display_name: '2026-06-10 Demo',
							isNested: 0,
							first_nest_filename: null,
							first_nest_display_name: null,
							first_section_content: '<p>A&#39;B &amp; C&#x26;D &nbsp;E</p>',
							first_speaker_name: 'Audrey',
						},
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		const xml = await res.text();
		// Numeric and hex entities get decoded before XML escaping
		// Named & stays as &amp; after re-escaping
		expect(xml).toContain('Audrey: A&apos;B &amp; C&amp;D');
	});

	it('leaves oversized numeric entities untouched', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							filename: '2026-06-11-demo',
							display_name: '2026-06-11 Demo',
							isNested: 0,
							first_nest_filename: null,
							first_nest_display_name: null,
							first_section_content: '<p>Invalid &#99999999999999;</p>',
							first_speaker_name: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('Invalid');
	});
});
