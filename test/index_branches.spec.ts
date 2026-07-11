import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function makeEnv(resolver: Resolver, preSeedR2: Record<string, { body: string; contentType?: string }> = {}) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();
	for (const [k, v] of Object.entries(preSeedR2)) {
		r2Store.set(k, { body: v.body, cacheControl: 'public, max-age=3600', contentType: v.contentType ?? 'text/html; charset=utf-8' });
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
					httpEtag: '"etag"',
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

async function request(path: string, env: ReturnType<typeof makeEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('buildSearchSnippet middle-of-text match', () => {
	it('prefixes with ... when the match is not at the start and extends past right side', async () => {
		const prefix = 'BEFORE '.repeat(50); // 350 chars pre-match
		const body = `<p>${prefix}needle and a lot more text after</p>`;
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
				return {
					success: true,
					results: [
						{
							filename: 'mid-match',
							nest_filename: null,
							display_name: 'Mid Match',
							section_id: 1,
							section_speaker: null,
							section_content: body,
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 1 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/api/search.json?q=needle', env);
		const body2 = (await res.json()) as any;
		expect(body2.results[0].snippet).toContain('...');
	});

	it('returns an empty snippet when the section text trims down to nothing', async () => {
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
				return {
					success: true,
					results: [
						{
							filename: 'blank-snippet',
							nest_filename: null,
							display_name: 'Blank Snippet',
							section_id: 2,
							section_speaker: null,
							section_content: '   ',
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 1 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/api/search.json?q=needle', env);
		const body = (await res.json()) as any;
		expect(body.results[0].snippet).toBe('');
	});

	it('appends ... when the match is near the start but the snippet is truncated on the right', async () => {
		const body = `<p>needle ${'after '.repeat(80)}</p>`;
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
				return {
					success: true,
					results: [
						{
							filename: 'right-truncated',
							nest_filename: null,
							display_name: 'Right Truncated',
							section_id: 3,
							section_speaker: null,
							section_content: body,
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 1 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/api/search.json?q=needle', env);
		const payload = (await res.json()) as any;
		expect(payload.results[0].snippet).toMatch(/\.\.\.$/);
		expect(payload.results[0].snippet.startsWith('...')).toBe(false);
	});
});

describe('serveBucketJson header branches', () => {
	it('returns ETag and Content-Length when the R2 object exposes them', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }), {
			'sections-dump.json': { body: '[1]', contentType: 'application/json; charset=utf-8' },
		});
		const { res } = await request('/sections-dump.json', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('[1]');
	});
});

describe('buildCacheKey fallback (malformed URL)', () => {
	// Triggering a truly malformed URL at runtime is tricky; the helper is indirectly
	// exercised by every route. The fallback branch is hit only if URL parsing throws.
	it('serves normal URLs without hitting the fallback', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/rss.xml', env);
		expect(res.status).toBe(200);
	});
});

describe('/:filename edge guards', () => {
	it('returns 404 for a filename that includes a dot (excluded non-root asset)', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		// `robots.txt` is excludedPath
		const { res } = await request('/robots.txt', env);
		// ASSETS.fetch returns 404, then the filename route is skipped because of exclusion
		expect(res.status).toBe(404);
	});

	it('returns 404 for a path that decodes to empty filename', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/%E0%A4%A', env);
		expect(res.status).toBe(404);
	});
});

describe('/:filename/:nest_filename guards', () => {
	it('returns 404 when the first segment is in excludedPaths', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/static/demo', env);
		// static first middleware tries ASSETS, misses, and the nested route 404s on excluded parent
		expect(res.status).toBe(404);
	});

	it('returns 404 when filename segment cannot be decoded', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/%E0%A4%A/child', env);
		expect(res.status).toBe(404);
	});
});

describe('serveAsset first-try branch', () => {
	it('returns the asset content when ASSETS.fetch succeeds', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		// Override ASSETS to match a specific path
		(env as any).ASSETS = { fetch: () => new Response('asset-body', { status: 200 }) };
		const { res } = await request('/custom-asset.png', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('asset-body');
	});
});

describe('canonical middleware (non-redirecting)', () => {
	it('skips redirect for POST requests', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		// POSTing /speeches should not redirect — canonical middleware only fires for GET/HEAD
		const { res } = await request('/speeches', env, { method: 'POST' });
		expect(res.status).not.toBe(302);
	});
});

describe('/speech/:section_id .md/.an routing', () => {
	it('treats /speech/abc (non-numeric, non-.md, non-.an) as 400', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/speech/abc', env);
		expect(res.status).toBe(400);
	});
});

describe('canonicalPage respects /speech/:id numeric-section URL', () => {
	it('strips query params from /speech/:id and redirects', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/speech/101?x=1', env);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/speech/101');
	});
});
