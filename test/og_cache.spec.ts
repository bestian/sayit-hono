import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function createEnv(resolver: Resolver, preSeed: Record<string, { body: string; contentType?: string; cacheControl?: string }> = {}) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();
	for (const [k, v] of Object.entries(preSeed)) {
		r2Store.set(k, { body: v.body, cacheControl: v.cacheControl ?? 'public, max-age=86400', contentType: v.contentType ?? 'image/png' });
	}
	return {
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
					arrayBuffer: async () => new TextEncoder().encode(entry.body).buffer
				};
			},
			put: async (key: string, body: string, options?: { httpMetadata?: { cacheControl?: string; contentType?: string } }) => {
				r2Store.set(key, { body, cacheControl: options?.httpMetadata?.cacheControl, contentType: options?.httpMetadata?.contentType });
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

async function request(path: string, env: ReturnType<typeof createEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('/og/speech/:id.png', () => {
	it('serves a cached PNG from SPEECH_CACHE when present', async () => {
		const env = createEnv(() => ({ success: true, results: [] }), {
			[`${CACHE_KEY_VERSION}/og/speech/42.png`]: { body: 'PNG-bytes', contentType: 'image/png' }
		});
		const { res } = await request('/og/speech/42.png', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/png');
		expect(await res.text()).toBe('PNG-bytes');
	});

	it('returns 404 when no section row exists', async () => {
		const env = createEnv(() => ({ success: true, results: [] }));
		const { res } = await request('/og/speech/99.png', env);
		expect(res.status).toBe(404);
	});

	it('returns 500 when loadSection throws', async () => {
		const env = createEnv((sql) => {
			if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await request('/og/speech/42.png', env);
		expect(res.status).toBe(500);
	});
});

describe('/og/*', () => {
	it('serves a cached PNG from SPEECH_CACHE for /og/<filename>.png', async () => {
		const env = createEnv(() => ({ success: true, results: [] }), {
			[`${CACHE_KEY_VERSION}/og/2026-demo.png`]: { body: 'PNG-bytes', contentType: 'image/png' }
		});
		const { res } = await request('/og/2026-demo.png', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('PNG-bytes');
	});

	it('returns 404 for unknown speech meta', async () => {
		const env = createEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) return { success: true, results: [] };
			return { success: true, results: [] };
		});
		const { res } = await request('/og/unknown.png', env);
		expect(res.status).toBe(404);
	});
});
