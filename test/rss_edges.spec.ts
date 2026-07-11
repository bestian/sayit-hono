import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function createRssEnv(resolver: Resolver, preSeedR2: Record<string, { body: string; cacheControl?: string; contentType?: string }> = {}) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();
	for (const [k, v] of Object.entries(preSeedR2)) {
		r2Store.set(k, {
			body: v.body,
			cacheControl: v.cacheControl ?? 'public, max-age=300',
			contentType: v.contentType ?? 'application/rss+xml; charset=utf-8',
		});
	}
	return {
		__r2Store: r2Store,
		AUDREYT_TRANSCRIPT_TOKEN: 'x',
		BESTIAN_TRANSCRIPT_TOKEN: 'y',
		ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
		SPEECH_CACHE: {
			get: async (key: string) => {
				const entry = r2Store.get(key);
				if (!entry) return null;
				return {
					body: entry.body,
					size: entry.body.length,
					httpEtag: null,
					httpMetadata: { cacheControl: entry.cacheControl, contentType: entry.contentType },
					text: async () => entry.body,
				};
			},
			put: async (key: string, body: string, options?: { httpMetadata?: { cacheControl?: string; contentType?: string } }) => {
				r2Store.set(key, { body, cacheControl: options?.httpMetadata?.cacheControl, contentType: options?.httpMetadata?.contentType });
			},
			delete: async (keys: string | string[]) => {
				for (const key of Array.isArray(keys) ? keys : [keys]) r2Store.delete(key);
			},
			list: async () => ({ objects: [], truncated: false, cursor: '' }),
		},
		DB: {
			prepare: (sql: string) => {
				const run = (args: unknown[]) => ({
					first: async () => resolver(sql, args).results[0] ?? null,
					all: async () => {
						const r = resolver(sql, args);
						return { success: r.success ?? true, results: r.results };
					},
				});
				return {
					bind: (...args: unknown[]) => run(args),
					first: async () => run([]).first(),
					all: async () => run([]).all(),
				};
			},
		},
	};
}

async function request(path: string, env: ReturnType<typeof createRssEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('/rss.xml', () => {
	it('serves feed with front-cache headers from R2 or DB', async () => {
		const env = createRssEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/rss.xml', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control') || '').toMatch(/s-maxage=/);
	});

	it('serves a cached R2 body without edge write', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/rss.xml`;
		const env = createRssEnv(() => ({ success: true, results: [] }), {
			[cacheKey]: { body: '<rss>cached</rss>', contentType: 'application/rss+xml; charset=utf-8' },
		});
		const { res } = await request('/rss.xml', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('cached');
	});

	it('renders a nested-speech item with combined title', async () => {
		const env = createRssEnv((sql) => {
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
		const { res } = await request('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('<title>2026-05-10 Parent / Child Display</title>');
		expect(xml).toContain('<link>https://archive.tw/2026-05-10-nested/child</link>');
		expect(xml).toContain('<pubDate>');
	});

	it('falls back to the feed description when no speaker and no summary', async () => {
		const env = createRssEnv((sql) => {
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
		const { res } = await request('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('<description>Latest transcripts from archive.tw</description>');
		expect(xml).not.toMatch(/<pubDate>[^<]+<\/pubDate>\s*<item>/);
	});

	it('rejects a malformed date in the filename by omitting pubDate', async () => {
		const env = createRssEnv((sql) => {
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
		const { res } = await request('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('<title>Invalid Date</title>');
		expect(xml.split('<item>')[1]).not.toContain('<pubDate>');
	});

	it('truncates long summaries with an ellipsis at a word boundary', async () => {
		const longBody = 'word '.repeat(200) + 'TAIL';
		const env = createRssEnv((sql) => {
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
		const { res } = await request('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('...');
		expect(xml).not.toContain('TAIL');
	});

	it('returns 500 when the DB query reports failure', async () => {
		const env = createRssEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/rss.xml', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 when the DB query throws', async () => {
		const env = createRssEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				throw new Error('boom');
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/rss.xml', env);
		expect(res.status).toBe(500);
	});

	it('serves /feed.xml identically', async () => {
		const env = createRssEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/feed.xml', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/rss+xml');
	});
});
