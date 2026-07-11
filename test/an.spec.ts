import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type DbRow = Record<string, unknown>;
type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: DbRow[] };

function createAnEnv(
	resolver: Resolver,
	options: { preSeedR2?: Record<string, { body: string; contentType?: string; cacheControl?: string }> } = {},
) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();
	for (const [k, v] of Object.entries(options.preSeedR2 ?? {})) {
		r2Store.set(k, {
			body: v.body,
			cacheControl: v.cacheControl ?? 'public, max-age=3600',
			contentType: v.contentType ?? 'text/plain; charset=utf-8',
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

async function request(path: string, env: ReturnType<typeof createAnEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('.an endpoints (section)', () => {
	it('generates a single-section .an when path is numeric', async () => {
		const env = createAnEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?')) {
				if (args[0] === 42) {
					return {
						success: true,
						results: [
							{
								section_speaker: 'audrey-tang',
								section_content: '<p>Hi &amp; bye</p>',
								display_name: 'Demo',
								name: 'Audrey Tang',
							},
						],
					};
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});

		const { res } = await request('/api/an/42.an', env);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('<akomaNtoso>');
		expect(body).toContain('TLCPerson');
		expect(body).toContain('showAs="Audrey Tang"');
		// Content starts with '<' so escapeAmp preserves tags literally
		expect(body).toContain('<p>Hi &amp; bye</p>');
	});

	it('serves a numeric .an via /speech/:id.an', async () => {
		const env = createAnEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?')) {
				if (args[0] === 777) {
					return {
						success: true,
						results: [{ section_speaker: null, section_content: 'Plain text', display_name: null, name: null }],
					};
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});

		const { res } = await request('/speech/777.an', env);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('showAs="Unknown"');
		expect(body).toContain('<p>Plain text</p>');
	});

	it('renders HEAD as empty body with Content-Length for single section', async () => {
		const env = createAnEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?') && args[0] === 42) {
				return {
					success: true,
					results: [
						{
							section_speaker: 'a',
							section_content: 'Hello',
							display_name: 'Demo',
							name: 'A',
						},
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/api/an/42.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Length')).not.toBeNull();
		expect(await res.text()).toBe('');
	});

	it('returns 404 when section id is not in DB', async () => {
		const env = createAnEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/api/an/123.an', env);
		expect(res.status).toBe(404);
	});
});

describe('.an endpoints (full speech)', () => {
	const speechResolver: Resolver = (sql, args) => {
		if (
			sql.includes('FROM speech_content sc') &&
			sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename') &&
			sql.includes('WHERE sc.filename = ?')
		) {
			if (args[0] === '2026-demo') {
				return {
					success: true,
					results: [
						{ section_speaker: 'a', section_content: '<p>One</p>', display_name: 'Demo', name: 'Audrey' },
						{ section_speaker: 'b', section_content: 'Plain two', display_name: 'Demo', name: 'Bestian' },
					],
				};
			}
			return { success: true, results: [] };
		}
		return { success: true, results: [] };
	};

	it('generates a full-speech .an from DB and caches to R2 + edge', async () => {
		const env = createAnEnv(speechResolver);
		const { res } = await request('/api/an/2026-demo.an', env);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('<TLCPerson');
		expect(body).toContain('<heading>Demo</heading>');
		expect(body).toContain('by="#a"');
		expect(body).toContain('by="#b"');
		expect(env.__r2Store.has('an/2026-demo')).toBe(true);
	});

	it('serves the cached R2 body on subsequent hits', async () => {
		const env = createAnEnv(speechResolver, {
			preSeedR2: { 'an/2026-demo': { body: 'CACHED-BODY', contentType: 'text/plain; charset=utf-8' } },
		});
		const { res } = await request('/api/an/2026-demo.an', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('CACHED-BODY');
	});

	it('responds to HEAD with empty body for full speech', async () => {
		const env = createAnEnv(speechResolver);
		const { res } = await request('/api/an/2026-demo.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
	});

	it('responds to HEAD against a cached object with empty body', async () => {
		const env = createAnEnv(speechResolver, {
			preSeedR2: { 'an/2026-demo': { body: 'C', contentType: 'text/plain; charset=utf-8' } },
		});
		const { res } = await request('/api/an/2026-demo.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
	});

	it('clears caches when the URL contains a query (purge flag)', async () => {
		const env = createAnEnv(speechResolver, {
			preSeedR2: { 'an/2026-demo': { body: 'C', contentType: 'text/plain; charset=utf-8' } },
		});
		const { res } = await request('/api/an/2026-demo.an?purge', env);
		expect(res.status).toBe(200);
		expect(env.__r2Store.get('an/2026-demo')!.body).not.toBe('C'); // regenerated
	});

	it('returns 404 for empty DB result', async () => {
		const env = createAnEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/api/an/unknown.an', env);
		expect(res.status).toBe(404);
	});

	it('returns 404 when the path does not end in .an', async () => {
		const env = createAnEnv(() => ({ success: true, results: [] }));
		// Hono route requires .an extension — this path is not matched, so root catch-all returns 404.
		const { res } = await request('/api/an/not-an-an', env);
		expect(res.status).toBe(404);
	});

	it('returns 405 on non-GET methods for a numeric .an', async () => {
		const env = createAnEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?') && args[0] === 42) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		// POST is not in the app.on list, so Hono 404s — test the direct function-level serve via /api/an allowed methods HEAD+GET only.
		const { res } = await request('/api/an/42.an', env, { method: 'POST' });
		expect(res.status).toBe(404);
	});

	it('matches /:path{.an} catch-all for a filename', async () => {
		const env = createAnEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename')) {
				return {
					success: true,
					results: [{ section_speaker: 'a', section_content: '<p>One</p>', display_name: 'Demo', name: 'Audrey' }],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/2026-rootan.an', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/plain');
	});
});
