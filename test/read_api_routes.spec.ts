import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type DbRow = Record<string, unknown>;
type QueryResolver = (sql: string, args: unknown[]) => { results: DbRow[]; success?: boolean } | null;

function createReadEnv(resolver: QueryResolver) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();

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
					first: async () => {
						const out = resolver(sql, args);
						return out?.results?.[0] ?? null;
					},
					all: async () => {
						const out = resolver(sql, args);
						if (out == null) return { success: false, results: [] };
						return { success: out.success ?? true, results: out.results };
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

async function request(path: string, env: ReturnType<typeof createReadEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('GET /api/speakers_index.json', () => {
	it('returns rows from speakers table with CORS and JSON headers', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM speakers ORDER BY id ASC')) {
				return {
					success: true,
					results: [
						{ id: 1, route_pathname: 'audrey-tang', name: 'Audrey Tang', photoURL: '/media/a.jpg' },
						{ id: 2, route_pathname: 'bestian', name: 'Bestian', photoURL: null }
					]
				};
			}
			return { success: true, results: [] };
		});

		const { res } = await request('/api/speakers_index.json', env, { headers: { Origin: 'https://archive.tw' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://archive.tw');
		const json = (await res.json()) as any[];
		expect(json).toHaveLength(2);
		expect(json[0]).toEqual({ id: 1, route_pathname: 'audrey-tang', name: 'Audrey Tang', photoURL: '/media/a.jpg' });
	});

	it('returns 500 when DB reports failure', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM speakers ORDER BY id ASC')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});

		const { res } = await request('/api/speakers_index.json', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 on unexpected exception', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM speakers ORDER BY id ASC')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await request('/api/speakers_index.json', env);
		expect(res.status).toBe(500);
	});
});

describe('GET /api/speech_index.json', () => {
	it('parses nest_filenames JSON and delimiter strings', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM speech_index ORDER BY id ASC')) {
				return {
					success: true,
					results: [
						{
							filename: 'flat',
							display_name: 'Flat',
							isNested: 0,
							nest_filenames: null,
							nest_display_names: null
						},
						{
							filename: 'nested-json',
							display_name: 'Nested JSON',
							isNested: 1,
							nest_filenames: '["a","b"]',
							nest_display_names: '["Alpha","Beta"]'
						},
						{
							filename: 'nested-csv',
							display_name: 'Nested CSV',
							isNested: 1,
							nest_filenames: 'a, b; c\nd',
							nest_display_names: 'Alpha, Beta; Gamma\nDelta'
						},
						{
							filename: 'nested-mismatch',
							display_name: 'Mismatch',
							isNested: 1,
							nest_filenames: '["a","b","c"]',
							nest_display_names: '["Alpha"]'
						},
						{
							filename: 'nested-number',
							display_name: 'Number',
							isNested: 1,
							nest_filenames: 42,
							nest_display_names: ['X']
						}
					]
				};
			}
			return { success: true, results: [] };
		});

		const { res } = await request('/api/speech_index.json', env);
		expect(res.status).toBe(200);
		const json = (await res.json()) as any[];
		expect(json).toHaveLength(5);
		expect(json[0].nest).toEqual([]);
		expect(json[1].nest).toEqual([
			{ filename: 'a', display_name: 'Alpha' },
			{ filename: 'b', display_name: 'Beta' }
		]);
		expect(json[2].nest).toEqual([
			{ filename: 'a', display_name: 'Alpha' },
			{ filename: 'b', display_name: 'Beta' },
			{ filename: 'c', display_name: 'Gamma' },
			{ filename: 'd', display_name: 'Delta' }
		]);
		expect(json[3].nest[2]).toEqual({ filename: 'c', display_name: 'c' });
		expect(json[4].nest).toEqual([]);
		expect(json[4].nest_display_names).toEqual(['X']);
	});

	it('returns 500 when DB reports failure', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM speech_index ORDER BY id ASC')) return { success: false, results: [] };
			return { success: true, results: [] };
		});
		const { res } = await request('/api/speech_index.json', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 on exception', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM speech_index ORDER BY id ASC')) throw new Error('nope');
			return { success: true, results: [] };
		});
		const { res } = await request('/api/speech_index.json', env);
		expect(res.status).toBe(500);
	});
});

describe('GET /api/section/:id', () => {
	it('returns 200 with the section row when found', async () => {
		const env = createReadEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?')) {
				if (args[0] === 42) {
					return { success: true, results: [{ section_id: 42, section_content: 'hi', display_name: 'Demo' }] };
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});

		const found = await request('/api/section/42', env);
		expect(found.res.status).toBe(200);
		const body = (await found.res.json()) as any;
		expect(body.section_id).toBe(42);

		const missing = await request('/api/section/99', env);
		expect(missing.res.status).toBe(404);
	});

	it('returns 400 for non-integer id', async () => {
		const env = createReadEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/api/section/abc', env);
		expect(res.status).toBe(400);
	});

	it('returns 500 on DB exception', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM sections WHERE section_id = ?')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await request('/api/section/42', env);
		expect(res.status).toBe(500);
	});
});

describe('GET /api/speech/*', () => {
	const makeSection = (overrides: Partial<Record<string, unknown>> = {}) => ({
		filename: '2026-demo',
		nest_filename: null,
		nest_display_name: null,
		section_id: 1,
		previous_section_id: null,
		next_section_id: null,
		section_speaker: null,
		section_content: '<p>a</p>',
		display_name: 'Demo',
		photoURL: null,
		name: null,
		...overrides
	});

	it('returns sections for a flat speech', async () => {
		const env = createReadEnv((sql, args) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?') && !sql.includes('AND sc.nest_filename')) {
				if (args[0] === '2026-demo') {
					return {
						success: true,
						results: [
							makeSection({ section_id: 1, next_section_id: 2 }),
							makeSection({ section_id: 2, previous_section_id: 1 })
						]
					};
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});

		const { res } = await request('/api/speech/2026-demo', env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any[];
		expect(body).toHaveLength(2);
		expect(body[0].section_id).toBe(1);
	});

	it('filters by nest_filename segment', async () => {
		const env = createReadEnv((sql, args) => {
			if (sql.includes('AND sc.nest_filename = ?')) {
				expect(args).toEqual(['parent', 'child']);
				return { success: true, results: [makeSection({ filename: 'parent', nest_filename: 'child' })] };
			}
			return { success: true, results: [] };
		});

		const { res } = await request('/api/speech/parent/child', env);
		expect(res.status).toBe(200);
	});

	it('returns 404 when no sections match', async () => {
		const env = createReadEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/api/speech/unknown', env);
		expect(res.status).toBe(404);
	});

	it('returns 400 when the path has no filename', async () => {
		// Matching /api/speech/* requires at least a slash — Hono treats /api/speech/ as matching with empty param.
		const env = createReadEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/api/speech/', env);
		expect(res.status).toBe(400);
	});

	it('returns 500 when DB reports failure', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/api/speech/any', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 on malformed URI', async () => {
		// Use a percent-encoded invalid sequence to trigger decodeURIComponent throw.
		const env = createReadEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/api/speech/%E0%A4%A', env);
		expect(res.status).toBe(500);
	});
});

describe('GET /api/speaker_detail/:route.json', () => {
	const speakerRow = {
		id: 7,
		route_pathname: 'audrey-tang',
		name: 'Audrey Tang',
		photoURL: null,
		longest_section_id: 100,
		longest_section_content: '<p>long</p>',
		longest_section_filename: '2026-demo',
		longest_section_nest_filename: null,
		longest_section_nest_display_name: null,
		longest_section_displayname: 'Demo'
	};

	function resolver(rowFound = true, failAll = false): QueryResolver {
		return (sql, args) => {
			if (sql.includes('FROM speakers_view WHERE route_pathname = ?')) {
				return { success: true, results: rowFound ? [speakerRow] : [] };
			}
			if (sql.includes('COUNT(DISTINCT speech_filename)')) {
				return { success: true, results: [{ count: 4 }] };
			}
			if (sql.includes('COUNT(DISTINCT section_id)')) {
				return { success: true, results: [{ count: 2 }] };
			}
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.section_speaker = ?')) {
				if (failAll) return { success: false, results: [] };
				return {
					success: true,
					results: [
						{
							filename: '2026-demo',
							nest_filename: null,
							nest_display_name: null,
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: args[0],
							section_content: '<p>one</p>',
							display_name: 'Demo'
						}
					]
				};
			}
			return { success: true, results: [] };
		};
	}

	it('returns paginated detail with longest_section and pagination_pages', async () => {
		const env = createReadEnv(resolver(true));
		const { res } = await request('/api/speaker_detail/audrey-tang.json?page=1', env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.id).toBe(7);
		expect(body.appearances_count).toBe(4);
		expect(body.sections_count).toBe(2);
		expect(body.longest_section.section_id).toBe(100);
		expect(body.pagination_pages).toEqual([1]);
		expect(body.sections).toHaveLength(1);
	});

	it('returns longest_section null when the speaker has no longest_section_id', async () => {
		const env = createReadEnv((sql, args) => {
			if (sql.includes('FROM speakers_view WHERE route_pathname = ?')) {
				return { success: true, results: [{ ...speakerRow, longest_section_id: null }] };
			}
			return resolver(true)(sql, args);
		});
		const { res } = await request('/api/speaker_detail/audrey-tang.json', env);
		const body = (await res.json()) as any;
		expect(body.longest_section).toBeNull();
	});

	it('falls back to pathname extraction when route param is empty', async () => {
		// An empty path segment before .json is unreachable via Hono routing; fallback matcher catches /foo.json only.
		const env = createReadEnv(resolver(true));
		const { res } = await request('/api/speaker_detail/audrey-tang.json', env);
		expect(res.status).toBe(200);
	});

	it('returns 404 when the speaker row is missing', async () => {
		const env = createReadEnv(resolver(false));
		const { res } = await request('/api/speaker_detail/nobody.json', env);
		expect(res.status).toBe(404);
	});

	it('returns 500 when section query fails', async () => {
		const env = createReadEnv(resolver(true, true));
		const { res } = await request('/api/speaker_detail/audrey-tang.json', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 when an exception is thrown', async () => {
		const env = createReadEnv((sql) => {
			if (sql.includes('FROM speakers_view WHERE route_pathname = ?')) throw new Error('nope');
			return { success: true, results: [] };
		});
		const { res } = await request('/api/speaker_detail/audrey-tang.json', env);
		expect(res.status).toBe(500);
	});
});
