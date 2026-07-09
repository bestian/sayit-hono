import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function makeEnv(preSeedR2: Record<string, { body: string; contentType?: string; cacheControl?: string; cacheTag?: string }> = {}) {
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string; customMetadata?: Record<string, string> }>();
	for (const [k, v] of Object.entries(preSeedR2)) {
		r2Store.set(k, {
			body: v.body,
			cacheControl: v.cacheControl ?? 'public, max-age=3600, s-maxage=3600',
			contentType: v.contentType,
			customMetadata: v.cacheTag ? { cacheTag: v.cacheTag } : undefined
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
					customMetadata: entry.customMetadata,
					text: async () => entry.body
				};
			},
			put: async (key: string, body: string, options?: { httpMetadata?: { cacheControl?: string; contentType?: string }; customMetadata?: Record<string, string> }) => {
				r2Store.set(key, {
					body,
					cacheControl: options?.httpMetadata?.cacheControl,
					contentType: options?.httpMetadata?.contentType,
					customMetadata: options?.customMetadata
				});
			},
			delete: async (keys: string | string[]) => {
				for (const key of Array.isArray(keys) ? keys : [keys]) r2Store.delete(key);
			},
			list: async () => ({ objects: [], truncated: false, cursor: '' })
		},
		DB: {
			prepare: () => {
				const run = () => ({
					first: async () => null,
					all: async () => ({ success: true, results: [] })
				});
				return {
					bind: () => run(),
					first: async () => null,
					all: async () => ({ success: true, results: [] })
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

describe('an origin cache (R2)', () => {
	it('serves an R2-cached body and ignores DB', async () => {
		const env = makeEnv({
			'an/demo-edge': {
				body: 'R2-AN',
				contentType: 'text/plain; charset=utf-8',
				cacheTag: 'speech:demo-edge'
			}
		});
		const { res } = await request('/api/an/demo-edge.an', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('R2-AN');
		expect(res.headers.get('Cache-Tag')).toContain('speech:');
		expect(res.headers.get('Cache-Control') || '').toMatch(/s-maxage=/);
	});

	it('HEAD on R2-cached an returns empty body', async () => {
		const env = makeEnv({
			'an/demo-edge-head': {
				body: 'R2-AN',
				contentType: 'text/plain; charset=utf-8',
				cacheTag: 'speech:demo-edge-head'
			}
		});
		const { res } = await request('/api/an/demo-edge-head.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
	});
});

describe('md origin cache (R2)', () => {
	it('serves an R2-cached body and ignores DB', async () => {
		const env = makeEnv({
			'md/demo-edge-md': {
				body: 'R2-MD',
				contentType: 'text/markdown; charset=utf-8',
				cacheTag: 'speech:demo-edge-md'
			}
		});
		const { res } = await request('/api/md/demo-edge-md.md', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('R2-MD');
		expect(res.headers.get('Cache-Tag')).toContain('speech:');
	});
});
