import { describe, expect, it } from 'vite-plus/test';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import { createMockEnv, dispatch } from './helpers/mockEnv';

describe('/rss.xml', () => {
	it('serves feed with front-cache headers from R2 or DB', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/rss.xml', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control') || '').toMatch(/s-maxage=/);
	});

	it('serves a cached R2 body without edge write', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/rss.xml`;
		const env = createMockEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { [cacheKey]: { body: '<rss>cached</rss>', contentType: 'application/rss+xml; charset=utf-8' } },
		});
		const { res } = await dispatch('/rss.xml', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('cached');
	});

	it('renders a nested-speech item with combined title', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							filename: '2026-05-10-nested',
							display_name: '2026-05-10 Parent',
							isNested: 1,
							first_nest_filename: 'child',
							first_nest_display_name: 'Child Display',
							first_section_content: '<p>Body</p>',
							first_speaker_name: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('<title>2026-05-10 Parent / Child Display</title>');
		expect(xml).toContain('<link>https://archive.tw/2026-05-10-nested/child</link>');
		expect(xml).toContain('<pubDate>');
	});

	it('falls back to the feed description when no speaker and no summary', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return {
					success: true,
					results: [
						{
							id: 2,
							filename: 'no-date-speech',
							display_name: 'No Date',
							isNested: 0,
							first_nest_filename: null,
							first_nest_display_name: null,
							first_section_content: null,
							first_speaker_name: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('<description>Latest transcripts from archive.tw</description>');
		expect(xml).not.toMatch(/<pubDate>[^<]+<\/pubDate>\s*<item>/);
	});

	it('rejects a malformed date in the filename by omitting pubDate', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return {
					success: true,
					results: [
						{
							id: 3,
							filename: '2026-13-99-bad',
							display_name: 'Invalid Date',
							isNested: 0,
							first_nest_filename: null,
							first_nest_display_name: null,
							first_section_content: '<p>Body text</p>',
							first_speaker_name: 'A',
						},
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('<title>Invalid Date</title>');
		expect(xml.split('<item>')[1]).not.toContain('<pubDate>');
	});

	it('truncates long summaries with an ellipsis at a word boundary', async () => {
		const longBody = 'word '.repeat(200) + 'TAIL';
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return {
					success: true,
					results: [
						{
							id: 4,
							filename: '2026-06-01-demo',
							display_name: '2026-06-01 Demo',
							isNested: 0,
							first_nest_filename: null,
							first_nest_display_name: null,
							first_section_content: `<p>${longBody}</p>`,
							first_speaker_name: ' ',
						},
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('...');
		expect(xml).not.toContain('TAIL');
	});

	it('returns 500 when the DB query reports failure', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 when the DB query throws', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				throw new Error('boom');
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		expect(res.status).toBe(500);
	});

	it('serves /feed.xml identically', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/feed.xml', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/rss+xml');
	});
});
