import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function createSimpleEnv() {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();
	const deletedKeys: string[] = [];

	return {
		__r2Store: r2Store,
		__deletedKeys: deletedKeys,
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
					httpMetadata: {
						cacheControl: entry.cacheControl,
						contentType: entry.contentType
					},
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
				for (const key of Array.isArray(keys) ? keys : [keys]) {
					r2Store.delete(key);
					deletedKeys.push(key);
				}
			},
			list: async ({ prefix = '', cursor, limit = 500 }: { prefix?: string; cursor?: string; limit?: number }) => {
				const matchingKeys = Array.from(r2Store.keys()).filter((key) => key.startsWith(prefix));
				const start = cursor ? Number(cursor) || 0 : 0;
				const slice = matchingKeys.slice(start, start + limit);
				const nextCursor = start + slice.length;
				return {
					objects: slice.map((key) => ({ key })),
					truncated: nextCursor < matchingKeys.length,
					cursor: `${nextCursor}`
				};
			}
		},
		DB: {
			prepare: () => ({
				bind: () => ({ first: async () => null, all: async () => ({ success: true, results: [] }) }),
				first: async () => null,
				all: async () => ({ success: true, results: [] })
			})
		}
	};
}

async function request(path: string, env: ReturnType<typeof createSimpleEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('CORS preflight on /api/*', () => {
	it('responds 200 with CORS headers for allowed origin', async () => {
		const env = createSimpleEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'OPTIONS',
			headers: { Origin: 'https://archive.tw' }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://archive.tw');
		expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
		expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
		expect(res.headers.get('Vary')).toBe('Origin');
	});

	it('responds 200 for localhost dev origin', async () => {
		const env = createSimpleEnv();
		const { res } = await request('/api/speech_index.json', env, {
			method: 'OPTIONS',
			headers: { Origin: 'http://localhost:5173' }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
	});

	it('rejects disallowed origin with 403', async () => {
		const env = createSimpleEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'OPTIONS',
			headers: { Origin: 'https://evil.example' }
		});
		expect(res.status).toBe(403);
	});

	it('rejects missing origin with 403', async () => {
		const env = createSimpleEnv();
		const { res } = await request('/api/upload_markdown', env, { method: 'OPTIONS' });
		expect(res.status).toBe(403);
	});
});

describe('POST /api/purge_cache', () => {
	it('deletes every R2 object', async () => {
		const env = createSimpleEnv();
		env.__r2Store.set(`${CACHE_KEY_VERSION}/example.com/a`, { body: '1' });
		env.__r2Store.set(`${CACHE_KEY_VERSION}/example.com/b`, { body: '2' });
		env.__r2Store.set('some-other-key', { body: '3' });

		const { res } = await request('/api/purge_cache', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey' }
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { deleted: number; purged: boolean };
		expect(body.deleted).toBe(3);
		expect(body.purged).toBe(true);
		expect(env.__r2Store.size).toBe(0);
	});

	it('accepts bestian token', async () => {
		const env = createSimpleEnv();
		env.__r2Store.set('k', { body: 'x' });

		const { res } = await request('/api/purge_cache', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-bestian' }
		});
		expect(res.status).toBe(200);
	});

	it('rejects missing token with 403', async () => {
		const env = createSimpleEnv();
		const { res } = await request('/api/purge_cache', env, { method: 'POST' });
		expect(res.status).toBe(403);
	});

	it('front_only skips R2 wipe and reports purge result', async () => {
		const env = createSimpleEnv();
		env.__r2Store.set('keep-me', { body: 'x' });
		const { res } = await request('/api/purge_cache?front_only=1', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey' }
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { frontOnly: boolean; purged: boolean };
		expect(body.frontOnly).toBe(true);
		expect(body.purged).toBe(true);
		expect(env.__r2Store.size).toBe(1);
	});
});

describe('Read route cache behavior', () => {
	it('serves speech detail from R2 cache when pre-seeded (cache hit)', async () => {
		const env = createSimpleEnv();
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/cached-speech`;
		env.__r2Store.set(cacheKey, {
			body: '<!doctype html><title>SEEDED</title><body>cached response</body>',
			cacheControl: 'public, max-age=3600',
			contentType: 'text/html; charset=utf-8'
		});

		const { res } = await request('/cached-speech', env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('SEEDED');
		expect(html).toContain('cached response');
	});

	it('does not serve speeches list from persistent R2 cache when pre-seeded', async () => {
		const env = createSimpleEnv();
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/speeches/`;
		env.__r2Store.set(cacheKey, {
			body: '<!doctype html><title>SPEECHES-SEEDED</title><body>speeches cache</body>',
			cacheControl: 'public, max-age=3600',
			contentType: 'text/html; charset=utf-8'
		});

		const { res } = await request('/speeches/', env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).not.toContain('SPEECHES-SEEDED');
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400');
		const speechCacheKeys = Array.from(env.__r2Store.keys()).filter((key) =>
			key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`)
		);
		expect(speechCacheKeys).toHaveLength(1);
	});
});
