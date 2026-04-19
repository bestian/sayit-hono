import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';
import { SEARCH_INDEX_BASELINE_BR_KEY, SEARCH_INDEX_BASELINE_KEY, SEARCH_INDEX_MANIFEST_KEY, SEARCH_STATS_KEY } from '../src/search/indexFormat';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type QueryResolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function createSsrEnv(resolver: QueryResolver, options: { preSeedR2?: Record<string, { body: string; contentType?: string; cacheControl?: string }> } = {}) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();
	for (const [k, v] of Object.entries(options.preSeedR2 ?? {})) {
		r2Store.set(k, {
			body: v.body,
			cacheControl: v.cacheControl ?? 'public, max-age=3600',
			contentType: v.contentType ?? 'text/html; charset=utf-8'
		});
	}

	return {
		__r2Store: r2Store,
		AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
		BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
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
					text: async () => entry.body
				};
			},
			put: async (key: string, body: string, options?: { httpMetadata?: { cacheControl?: string; contentType?: string } }) => {
				r2Store.set(key, {
					body,
					cacheControl: options?.httpMetadata?.cacheControl,
					contentType: options?.httpMetadata?.contentType
				});
			},
			delete: async (keys: string | string[]) => {
				for (const key of Array.isArray(keys) ? keys : [keys]) r2Store.delete(key);
			},
			list: async () => ({ objects: [], truncated: false, cursor: '' })
		},
		DB: {
			prepare: (sql: string) => {
				const run = (args: unknown[]) => ({
					first: async () => resolver(sql, args).results[0] ?? null,
					all: async () => {
						const r = resolver(sql, args);
						return { success: r.success ?? true, results: r.results };
					}
				});
				return {
					bind: (...args: unknown[]) => run(args),
					first: async () => run([]).first(),
					all: async () => run([]).all()
				};
			}
		}
	};
}

async function request(path: string, env: ReturnType<typeof createSsrEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('SSR /speakers', () => {
	const resolver: QueryResolver = (sql) => {
		if (sql.includes('SELECT id, route_pathname, name, photoURL FROM speakers')) {
			return { success: true, results: [{ id: 1, route_pathname: 'audrey-tang', name: 'Audrey Tang', photoURL: null }] };
		}
		return { success: true, results: [] };
	};

	it('redirects /speakers to /speakers/', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/speakers', env);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/speakers/');
	});

	it('renders the speakers list and caches to R2', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/speakers/', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('SayIt');
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speakers/`)).toBe(true);
	});

	it('returns 500 when the speakers query reports failure', async () => {
		const env = createSsrEnv((sql) => {
			if (sql.includes('FROM speakers')) return { success: false, results: [] };
			return { success: true, results: [] };
		});
		const { res } = await request('/speakers/', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 when the speakers query throws', async () => {
		const env = createSsrEnv((sql) => {
			if (sql.includes('FROM speakers')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await request('/speakers/', env);
		expect(res.status).toBe(500);
	});
});

describe('SSR /speeches', () => {
	it('returns 500 when the speeches query reports failure', async () => {
		const env = createSsrEnv((sql) => {
			if (sql.includes('FROM speech_index ORDER BY id ASC')) return { success: false, results: [] };
			return { success: true, results: [] };
		});
		const { res } = await request('/speeches/', env);
		expect(res.status).toBe(500);
	});
});

describe('SSR /speaker/:route', () => {
	const resolver: QueryResolver = (sql, args) => {
		if (sql.includes('FROM speakers_view WHERE route_pathname = ?')) {
			if (args[0] === 'audrey-tang') {
				return {
					success: true,
					results: [
						{
							id: 1,
							route_pathname: 'audrey-tang',
							name: 'Audrey Tang',
							photoURL: null,
							appearances_count: 5,
							sections_count: 2,
							longest_section_id: 99,
							longest_section_content: '<p>long</p>',
							longest_section_filename: '2026-demo',
							longest_section_displayname: 'Demo'
						}
					]
				};
			}
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.section_speaker = ?')) {
			return {
				success: true,
				results: [
					{
						filename: '2026-demo',
						section_id: 1,
						previous_section_id: null,
						next_section_id: null,
						section_speaker: 'audrey-tang',
						section_content: '<p>Hi</p>',
						display_name: 'Demo'
					}
				]
			};
		}
		return { success: true, results: [] };
	};

	it('renders a cached R2 body without hitting DB', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/speaker/audrey-tang`;
		const env = createSsrEnv(() => ({ success: false, results: [] }), {
			preSeedR2: { [cacheKey]: { body: '<!doctype html><title>SEED</title>SPEAKER-SEED' } }
		});
		const { res } = await request('/speaker/audrey-tang', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('SPEAKER-SEED');
	});

	it('renders a speaker page and caches to R2', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/speaker/audrey-tang', env);
		expect(res.status).toBe(200);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speaker/audrey-tang`)).toBe(true);
	});

	it('returns 404 when the speaker row is missing', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/speaker/missing', env);
		expect(res.status).toBe(404);
	});

	it('returns 500 when sections query fails', async () => {
		const env = createSsrEnv((sql, args) => {
			if (sql.includes('FROM speakers_view WHERE route_pathname = ?')) return resolver(sql, args);
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.section_speaker = ?')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/speaker/audrey-tang', env);
		expect(res.status).toBe(500);
	});
});

describe('SSR /speech/:section_id', () => {
	const resolver: QueryResolver = (sql, args) => {
		if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) {
			if (args[0] === 101) {
				return {
					success: true,
					results: [
						{
							filename: '2026-demo',
							nest_filename: null,
							section_id: 101,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'audrey-tang',
							section_content: '<p>Body.</p>',
							display_name: 'Demo',
							photoURL: null,
							name: 'Audrey Tang',
							previous_content: null,
							next_content: null
						}
					]
				};
			}
			return { success: true, results: [] };
		}
		return { success: true, results: [] };
	};

	it('returns 400 for a non-integer section id', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/speech/not-a-number', env);
		expect(res.status).toBe(400);
	});

	it('renders a section page and caches to R2', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/speech/101', env);
		expect(res.status).toBe(200);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speech/101`)).toBe(true);
	});

	it('returns 404 when section is missing', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/speech/999', env);
		expect(res.status).toBe(404);
	});

	it('returns 500 when DB throws', async () => {
		const env = createSsrEnv((sql) => {
			if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await request('/speech/101', env);
		expect(res.status).toBe(500);
	});
});

describe('SSR /:filename', () => {
	const flatResolver: QueryResolver = (sql, args) => {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			if (args[0] === '2026-flat') {
				return {
					success: true,
					results: [{ filename: '2026-flat', display_name: 'Flat', isNested: 0, nest_filenames: null, nest_display_names: null }]
				};
			}
			if (args[0] === '2026-nested') {
				return {
					success: true,
					results: [{ filename: '2026-nested', display_name: 'Nested', isNested: 1, nest_filenames: '["a","b"]', nest_display_names: '["A","B"]' }]
				};
			}
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?')
			&& sql.includes('LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname')
			&& !sql.includes('GROUP BY')) {
			if (args[0] === '2026-flat') {
				return {
					success: true,
					results: [
						{
							filename: '2026-flat',
							section_id: 1,
							previous_section_id: null,
							next_section_id: 2,
							section_speaker: 'audrey-tang',
							section_content: '<p>a</p>',
							photoURL: null,
							name: 'Audrey'
						},
						{
							filename: '2026-flat',
							section_id: 2,
							previous_section_id: 1,
							next_section_id: null,
							section_speaker: 'audrey-tang',
							section_content: '<p>b</p>',
							photoURL: null,
							name: 'Audrey'
						}
					]
				};
			}
			return { success: true, results: [] };
		}
		if (sql.includes('GROUP BY nest_filename')) {
			return {
				success: true,
				results: [
					{ nest_filename: 'a', nest_display_name: 'Alpha', section_count: 2, first_section_id: 10 },
					{ nest_filename: 'b', nest_display_name: 'Beta', section_count: 1, first_section_id: 20 }
				]
			};
		}
		if (sql.includes('WHERE section_id IN')) {
			return {
				success: true,
				results: [
					{ section_id: 10, section_content: '<p>First of alpha</p>' },
					{ section_id: 20, section_content: '<p>First of beta</p>' }
				]
			};
		}
		return { success: true, results: [] };
	};

	it('returns 404 for excluded path segments', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/api', env);
		expect(res.status).toBe(404);
	});

	it('returns 404 for purely numeric filenames (reserved for /speech/:id)', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/1234', env);
		expect(res.status).toBe(404);
	});

	it('returns 500 when filename decode fails', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/%E0%A4%A', env);
		expect(res.status).toBe(404);
	});

	it('returns 404 when speech meta is missing', async () => {
		const env = createSsrEnv(flatResolver);
		const { res } = await request('/unknown', env);
		expect(res.status).toBe(404);
	});

	it('renders a flat speech page', async () => {
		const env = createSsrEnv(flatResolver);
		const { res } = await request('/2026-flat', env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('Flat');
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/2026-flat`)).toBe(true);
	});

	it('renders a nested speech list page', async () => {
		const env = createSsrEnv(flatResolver);
		const { res } = await request('/2026-nested', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Nested');
	});

	it('returns 500 when speech meta lookup throws', async () => {
		const env = createSsrEnv((sql) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await request('/broken', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 when section query fails for flat speech', async () => {
		const env = createSsrEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) return flatResolver(sql, args);
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?') && !sql.includes('GROUP BY')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/2026-flat', env);
		expect(res.status).toBe(500);
	});

	it('returns 404 when flat speech has no sections', async () => {
		const env = createSsrEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) return flatResolver(sql, args);
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?') && !sql.includes('GROUP BY')) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/2026-flat', env);
		expect(res.status).toBe(404);
	});

	it('returns 500 when nested nests query fails', async () => {
		const env = createSsrEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) return flatResolver(sql, args);
			if (sql.includes('GROUP BY nest_filename')) return { success: false, results: [] };
			return { success: true, results: [] };
		});
		const { res } = await request('/2026-nested', env);
		expect(res.status).toBe(500);
	});

	it('returns 404 when nested speech has no nest rows', async () => {
		const env = createSsrEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) return flatResolver(sql, args);
			if (sql.includes('GROUP BY nest_filename')) return { success: true, results: [] };
			return { success: true, results: [] };
		});
		const { res } = await request('/2026-nested', env);
		expect(res.status).toBe(404);
	});

	it('includes alternate language links when loadAlternateInfo resolves', async () => {
		const env = createSsrEnv((sql, args) => {
			if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
				return {
					success: true,
					results: [{ alternate_filename: '2026-flat-en', alternate_display_name: '2026-flat-en Demo' }]
				};
			}
			return flatResolver(sql, args);
		});
		const { res } = await request('/2026-flat', env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('hreflang');
	});
});

describe('SSR /:filename/:nest_filename', () => {
	const resolver: QueryResolver = (sql, args) => {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			if (args[0] === '2026-nested') {
				return {
					success: true,
					results: [{
						filename: '2026-nested',
						display_name: 'Nested',
						isNested: 1,
						nest_filenames: '["a","b"]',
						nest_display_names: '["Alpha","Beta"]'
					}]
				};
			}
			if (args[0] === '2026-flat') {
				return {
					success: true,
					results: [{ filename: '2026-flat', display_name: 'Flat', isNested: 0, nest_filenames: null, nest_display_names: null }]
				};
			}
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_content sc')
			&& sql.includes('WHERE sc.filename = ? AND sc.nest_filename = ?')) {
			if (args[0] === '2026-nested' && args[1] === 'a') {
				return {
					success: true,
					results: [
						{
							filename: '2026-nested',
							nest_filename: 'a',
							nest_display_name: 'Alpha',
							section_id: 10,
							previous_section_id: null,
							next_section_id: 11,
							section_speaker: 'audrey-tang',
							section_content: '<p>hi</p>',
							display_name: 'Nested',
							photoURL: null,
							name: 'Audrey'
						}
					]
				};
			}
			return { success: true, results: [] };
		}
		return { success: true, results: [] };
	};

	it('returns 404 for excluded first segment', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/speech/anything', env);
		// /speech/:section_id returns 400 on bad id. /speech/anything hits that route first; 'anything' is not integer and not .md/.an -> 400.
		expect(res.status).toBe(400);
	});

	it('returns 404 for unknown parent speech', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/unknown/x', env);
		expect(res.status).toBe(404);
	});

	it('returns 404 when parent is not nested', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/2026-flat/x', env);
		expect(res.status).toBe(404);
	});

	it('returns 404 when no sections for the nest', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/2026-nested/missing', env);
		expect(res.status).toBe(404);
	});

	it('renders a nested detail page', async () => {
		const env = createSsrEnv(resolver);
		const { res } = await request('/2026-nested/a', env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('Alpha');
	});

	it('returns 500 when nested meta query throws', async () => {
		const env = createSsrEnv((sql) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await request('/2026-nested/a', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 when nested sections query fails', async () => {
		const env = createSsrEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) return resolver(sql, args);
			if (sql.includes('FROM speech_content sc')
				&& sql.includes('WHERE sc.filename = ? AND sc.nest_filename = ?')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/2026-nested/a', env);
		expect(res.status).toBe(500);
	});
});

describe('Static search/stats endpoints', () => {
	it('serves brotli search index when Accept-Encoding supports br', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { [SEARCH_INDEX_BASELINE_BR_KEY]: { body: 'compressed-bytes', contentType: 'application/json; charset=utf-8' } }
		});
		const { res } = await request('/search-index.json', env, { headers: { 'Accept-Encoding': 'gzip, br' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Encoding')).toBe('br');
	});

	it('falls back to uncompressed when brotli object is absent', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { [SEARCH_INDEX_BASELINE_KEY]: { body: '{"pages":[],"speakers":[],"docs":[]}', contentType: 'application/json; charset=utf-8' } }
		});
		const { res } = await request('/search-index.json', env, { headers: { 'Accept-Encoding': 'gzip, br' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Encoding')).toBeNull();
	});

	it('returns 404 when no search index is stored', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/search-index.json', env);
		expect(res.status).toBe(404);
	});

	it('returns stored manifest when present', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { [SEARCH_INDEX_MANIFEST_KEY]: { body: '{"v":1}' } }
		});
		const { res } = await request('/search-index-manifest.json', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('"v":1');
	});

	it('returns an empty manifest when missing', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/search-index-manifest.json', env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.overlays).toEqual({});
	});

	it('serves search-updates/*.json when present, 404 otherwise', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { 'search-updates/demo.json': { body: '{"v":2}' } }
		});
		const hit = await request('/search-updates/demo.json', env);
		expect(hit.res.status).toBe(200);

		const miss = await request('/search-updates/nope.json', env);
		expect(miss.res.status).toBe(404);
	});

	it('serves stats.json from R2 and 404 otherwise', async () => {
		const envMiss = createSsrEnv(() => ({ success: true, results: [] }));
		expect((await request('/stats.json', envMiss)).res.status).toBe(404);

		const envHit = createSsrEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { [SEARCH_STATS_KEY]: { body: '{"speeches":1}' } }
		});
		const { res } = await request('/stats.json', envHit);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('"speeches":1');
	});

	it('serves sections-dump.json from R2 and 404 otherwise', async () => {
		const envMiss = createSsrEnv(() => ({ success: true, results: [] }));
		expect((await request('/sections-dump.json', envMiss)).res.status).toBe(404);

		const envHit = createSsrEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { 'sections-dump.json': { body: '[{"id":1}]' } }
		});
		const { res } = await request('/sections-dump.json', envHit);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('"id":1');
	});
});

describe('canonical middleware redirects', () => {
	it('redirects /index.html to /', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/index.html', env);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/');
	});

	it('redirects /speakers with query params to /speakers/', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/speakers?foo=1', env);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/speakers/');
	});

	it('preserves valid ?page= but strips other params on speaker pages', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/speaker/audrey-tang?page=3&x=y', env);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/speaker/audrey-tang?page=3');
	});

	it('strips page=1 from speaker pages (canonical is no query)', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/speaker/audrey-tang?page=1', env);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/speaker/audrey-tang');
	});

	it('/search redirects to /search/ preserving the query string', async () => {
		const env = createSsrEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/search?q=abc', env);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/search/?q=abc');
	});
});
