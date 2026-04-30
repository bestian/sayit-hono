import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function makeEnv(resolver: Resolver, preSeedR2: Record<string, { body: string; etag?: string | null; contentType?: string }> = {}) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string; etag: string | null }>();
	for (const [k, v] of Object.entries(preSeedR2)) {
		r2Store.set(k, {
			body: v.body,
			cacheControl: 'public, max-age=3600',
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
				r2Store.set(key, { body, cacheControl: options?.httpMetadata?.cacheControl, contentType: options?.httpMetadata?.contentType, etag: null });
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

describe('/speeches/ render (happy path without R2 preseed)', () => {
	it('renders HTML from DB and stores it behind a data-versioned R2 key', async () => {
		const env = makeEnv((sql) => {
			if (sql.includes('SELECT filename, display_name FROM speech_index ORDER BY id ASC')) {
				return {
					success: true,
					results: [
						{ filename: '2026-a-demo', display_name: 'A Demo' },
						{ filename: '2026-b-demo', display_name: 'B Demo' }
					]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/speeches/', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('A Demo');
		expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
		const speechCacheKeys = Array.from(env.__r2Store.keys()).filter((key) =>
			key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`)
		);
		expect(speechCacheKeys).toHaveLength(1);
	});

	it('misses old speeches R2 HTML when the speech list data changes', async () => {
		let rows = [{ filename: '2026-a-demo', display_name: 'A Demo' }];
		const env = makeEnv((sql) => {
			if (sql.includes('SELECT filename, display_name FROM speech_index ORDER BY id ASC')) {
				return { success: true, results: rows };
			}
			return { success: true, results: [] };
		});

		const first = await request('/speeches/', env);
		expect(await first.res.text()).toContain('A Demo');
		const [oldKey] = Array.from(env.__r2Store.keys()).filter((key) =>
			key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`)
		);
		expect(oldKey).toBeDefined();
		env.__r2Store.set(oldKey!, {
			body: '<!doctype html><title>OLD</title><body>OLD-CACHED</body>',
			cacheControl: 'no-store, no-cache, must-revalidate',
			contentType: 'text/html; charset=utf-8',
			etag: null
		});

		rows = [{ filename: '2026-b-demo', display_name: 'B Demo' }];
		const second = await request('/speeches/', env);
		const html = await second.res.text();
		expect(html).toContain('B Demo');
		expect(html).not.toContain('OLD-CACHED');
		const speechCacheKeys = Array.from(env.__r2Store.keys()).filter((key) =>
			key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`)
		);
		expect(speechCacheKeys).toHaveLength(2);
	});
});

describe('/speakers/ R2 cache hit', () => {
	it('returns the preseeded body without calling DB', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/speakers/`;
		const env = makeEnv(() => ({ success: false, results: [] }), {
			[cacheKey]: { body: '<!doctype html><title>SEED</title>SPEAKERS-SEED' }
		});
		const { res } = await request('/speakers/', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('SPEAKERS-SEED');
	});
});

describe('serveBucketJson surfaces ETag', () => {
	it('exposes the ETag header when R2 has one', async () => {
		const env = makeEnv(() => ({ success: true, results: [] }), {
			'stats.json': { body: '{"n":1}', etag: '"abc"', contentType: 'application/json; charset=utf-8' }
		});
		const { res } = await request('/stats.json', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('ETag')).toBe('"abc"');
	});
});

describe('rss decodeHtmlEntities fallback when URL fails to parse', () => {
	// buildCacheKey in rss.ts has a fallback path that strips protocol manually.
	// It's only hit when `new URL(...)` throws; virtually unreachable in normal flow,
	// but we include an integration-level smoke to keep the handler wired up.
	it('still produces XML for an unusual host URL', async () => {
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/rss.xml', env);
		expect(res.headers.get('content-type')).toContain('application/rss+xml');
	});
});
