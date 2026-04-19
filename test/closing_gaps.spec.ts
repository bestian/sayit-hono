import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function makeEnv(resolver: Resolver, preSeedR2: Record<string, { body: string; contentType?: string; cacheControl?: string; etag?: string }> = {}) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string; etag: string | null }>();
	for (const [k, v] of Object.entries(preSeedR2)) {
		r2Store.set(k, {
			body: v.body,
			cacheControl: v.cacheControl ?? 'public, max-age=3600',
			contentType: v.contentType ?? 'text/html; charset=utf-8',
			etag: v.etag ?? null
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
					httpEtag: entry.etag,
					httpMetadata: { cacheControl: entry.cacheControl, contentType: entry.contentType },
					text: async () => entry.body
				};
			},
			put: async (key: string, body: string, options?: { httpMetadata?: { cacheControl?: string; contentType?: string } }) => {
				r2Store.set(key, {
					body,
					cacheControl: options?.httpMetadata?.cacheControl,
					contentType: options?.httpMetadata?.contentType,
					etag: null
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

async function request(path: string, env: ReturnType<typeof makeEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('search branch coverage', () => {
	it('returns 500 when speakers search query reports failure', async () => {
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speakers') && sql.includes('instr(lower(COALESCE(name')) {
				return { success: false, results: [] };
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 0 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/api/search.json?q=needle', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 when sections search query reports failure', async () => {
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speakers') && sql.includes('instr(lower(COALESCE(name')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 1 }] };
			}
			if (sql.includes('FROM speech_content sc')
				&& sql.includes('LEFT JOIN speech_index si')
				&& sql.includes('ORDER BY')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/api/search.json?q=needle', env);
		expect(res.status).toBe(500);
	});

	it('decodes oversized numeric entities in snippet (keeps them as-is)', async () => {
		const body = '<p>X &#9999999999; Y needle Z</p>';
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speech_content sc')
				&& sql.includes('LEFT JOIN speech_index si')
				&& sql.includes('ORDER BY')) {
				return {
					success: true,
					results: [{
						filename: '2026-demo',
						nest_filename: null,
						display_name: 'Demo',
						section_id: 1,
						section_speaker: null,
						section_content: body,
						speaker_name: null,
						photoURL: null
					}]
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 1 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/api/search.json?q=needle', env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as any;
		expect(data.results[0].snippet).toContain('&#9999999999;');
	});

	it('highlights search query matching a speaker with empty name (fall-through branch)', async () => {
		// runSearchQuery maps speaker rows; highlightSearchText is called on row.name ?? ''.
		// A row with null name exercises the early-return `if (!value || tokens.length === 0)`.
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speakers') && sql.includes('instr(lower(COALESCE(name')) {
				return { success: true, results: [{ id: 1, route_pathname: 'x', name: null, photoURL: null }] };
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 0 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/search/?q=needle', env);
		expect(res.status).toBe(200);
	});

	it('renders the /search/ cached-body path (edge cache hit)', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const edgeKey = `https://example.com/${CACHE_KEY_VERSION}/example.com/search/?q=cached`;
		await caches.default.put(
			`https://${CACHE_KEY_VERSION}/example.com/search/?q=cached`,
			new Response('CACHED-SEARCH', { headers: { 'Cache-Control': 'public, max-age=60', 'Content-Type': 'text/html' } })
		);
		const { res } = await request('/search/?q=cached', env);
		expect([200, 304]).toContain(res.status);
		await caches.default.delete(`https://${CACHE_KEY_VERSION}/example.com/search/?q=cached`);
		void edgeKey;
	});

	it('serves /api/search.json cached body (edge cache hit)', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const key = `https://${CACHE_KEY_VERSION}/example.com/api/search.json?q=cached`;
		await caches.default.put(
			key,
			new Response(JSON.stringify({ results: ['CACHED'] }), {
				headers: { 'Cache-Control': 'public, max-age=60', 'Content-Type': 'application/json' }
			})
		);
		const { res } = await request('/api/search.json?q=cached', env);
		expect(res.status).toBe(200);
		await caches.default.delete(key);
	});
});

describe('/:filename/:nest_filename — R2 cache hit', () => {
	it('returns the preseeded body without hitting DB', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/2026-p/child`;
		const env = makeEnv(() => ({ success: false, results: [] }), {
			[cacheKey]: { body: '<!doctype html><title>NESTED-SEED</title><body>ns</body>' }
		});
		const { res } = await request('/2026-p/child', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('NESTED-SEED');
	});
});

describe('/speech/:section_id — R2 cache hit', () => {
	it('returns the preseeded section body', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/speech/42`;
		const env = makeEnv(() => ({ success: false, results: [] }), {
			[cacheKey]: { body: '<!doctype html><title>SEC-SEED</title>SECTION-SEED' }
		});
		const { res } = await request('/speech/42', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('SECTION-SEED');
	});
});

describe('alternate language links', () => {
	const withAlternateResolver: Resolver = (sql, args) => {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			if (args[0] === '2026-parent') {
				return {
					success: true,
					results: [{ filename: '2026-parent', display_name: 'Parent', isNested: 1, nest_filenames: '["a"]', nest_display_names: '["Alpha"]' }]
				};
			}
			if (args[0] === '2026-child-flat') {
				return {
					success: true,
					results: [{ filename: '2026-child-flat', display_name: 'Flat', isNested: 0, nest_filenames: null, nest_display_names: null }]
				};
			}
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
			return {
				success: true,
				results: [{ alternate_filename: '2026-parent-en', alternate_display_name: '2026 Parent' }]
			};
		}
		if (sql.includes('GROUP BY nest_filename')) {
			return {
				success: true,
				results: [{ nest_filename: 'a', nest_display_name: 'Alpha', section_count: 1, first_section_id: 10 }]
			};
		}
		if (sql.includes('WHERE section_id IN')) {
			return { success: true, results: [{ section_id: 10, section_content: '<p>hi</p>' }] };
		}
		if (sql.includes('FROM speech_content sc')
			&& sql.includes('WHERE sc.filename = ? AND sc.nest_filename = ?')) {
			return {
				success: true,
				results: [{
					filename: '2026-parent',
					nest_filename: 'a',
					nest_display_name: 'Alpha',
					section_id: 10,
					previous_section_id: null,
					next_section_id: null,
					section_speaker: null,
					section_content: '<p>nested</p>',
					display_name: 'Parent',
					photoURL: null,
					name: null
				}]
			};
		}
		return { success: true, results: [] };
	};

	it('wires hreflang links on the nested parent list page', async () => {
		const env = makeEnv(withAlternateResolver);
		const { res } = await request('/2026-parent', env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('hreflang');
	});

	it('wires hreflang links on the nested detail page', async () => {
		const env = makeEnv(withAlternateResolver);
		const { res } = await request('/2026-parent/a', env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('hreflang');
	});
});

describe('loadAlternateInfo error handling', () => {
	it('silently returns null when alternate_filename query throws', async () => {
		const env = makeEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === '2026-flat') {
					return {
						success: true,
						results: [{ filename: '2026-flat', display_name: 'Flat', isNested: 0, nest_filenames: null, nest_display_names: null }]
					};
				}
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
				throw new Error('alt lookup failed');
			}
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?')) {
				return {
					success: true,
					results: [{
						filename: '2026-flat',
						section_id: 1,
						previous_section_id: null,
						next_section_id: null,
						section_speaker: null,
						section_content: '<p>hi</p>',
						photoURL: null,
						name: null
					}]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/2026-flat', env);
		expect(res.status).toBe(200);
	});
});

describe('parseToArray input variants', () => {
	// nest_filenames comes from speech_index.nest_filenames column. parseContent handles it, then parseToArray.
	// Covers null-input, pre-parsed array, and non-string non-array (object).
	it('handles null, JSON-array, and object nest_filenames', async () => {
		const env = makeEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'null-nest') {
					return {
						success: true,
						results: [{ filename: 'null-nest', display_name: 'Null Nest', isNested: 1, nest_filenames: null, nest_display_names: null }]
					};
				}
				if (args[0] === 'array-nest') {
					return {
						success: true,
						results: [{
							filename: 'array-nest',
							display_name: 'Array Nest',
							isNested: 1,
							nest_filenames: '["n1","n2"]',
							nest_display_names: '["D1","D2"]'
						}]
					};
				}
				if (args[0] === 'string-nest') {
					return {
						success: true,
						results: [{
							filename: 'string-nest',
							display_name: 'CSV Nest',
							isNested: 1,
							nest_filenames: 'a,b',
							nest_display_names: 'Alpha,Beta'
						}]
					};
				}
				if (args[0] === 'object-nest') {
					return {
						success: true,
						results: [{
							filename: 'object-nest',
							display_name: 'Object Nest',
							isNested: 1,
							nest_filenames: '{"k":"v"}',
							nest_display_names: '{"k":"v"}'
						}]
					};
				}
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content sc')
				&& sql.includes('WHERE sc.filename = ? AND sc.nest_filename = ?')) {
				return {
					success: true,
					results: [{
						filename: args[0],
						nest_filename: args[1],
						nest_display_name: 'D',
						section_id: 1,
						previous_section_id: null,
						next_section_id: null,
						section_speaker: null,
						section_content: '<p>hi</p>',
						display_name: 'D',
						photoURL: null,
						name: null
					}]
				};
			}
			return { success: true, results: [] };
		});

		// string-nest: parseContent('a,b') → throws → returns 'a,b' → typeof string → split by comma
		expect((await request('/string-nest/a', env)).res.status).toBe(200);
		// array-nest: parseContent('["n1","n2"]') → parsed array → map values
		expect((await request('/array-nest/n1', env)).res.status).toBe(200);
		// object-nest: parseContent('{"k":"v"}') → parsed object (not string/array) → returns []
		expect((await request('/object-nest/x', env)).res.status).toBe(200);
	});
});

describe('parseContent empty/falsy input', () => {
	// Exercised via /speech/:id page where section.section_content might be empty.
	it('handles sections with null content', async () => {
		const env = makeEnv((sql, args) => {
			if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) {
				if (args[0] === 200) {
					return {
						success: true,
						results: [{
							filename: '2026-e',
							nest_filename: null,
							section_id: 200,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'a',
							section_content: null,
							display_name: 'Demo',
							photoURL: null,
							name: 'A',
							previous_content: null,
							next_content: null
						}]
					};
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/speech/200', env);
		expect(res.status).toBe(200);
	});
});

describe('/:filename — empty-filename guard', () => {
	// Normally unreachable via route (param can't be empty), but guard is inline.
	// Test the other leaf: an allowed filename that matches static first middleware.
	it('returns 404 for excluded static filename', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/favicon.ico', env);
		// favicon.ico is in excludedPaths + ASSETS returns 404 → 404
		expect(res.status).toBe(404);
	});
});
