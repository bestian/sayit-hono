import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function makeEnv() {
	return {
		AUDREYT_TRANSCRIPT_TOKEN: 'x',
		BESTIAN_TRANSCRIPT_TOKEN: 'y',
		ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
		SPEECH_CACHE: {
			get: async () => null,
			put: async () => {},
			delete: async () => true,
			list: async () => ({ objects: [], truncated: false, cursor: '' })
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

async function request(path: string, env: ReturnType<typeof makeEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('edge cache hits for /api/an/*.an', () => {
	it('serves an edge-cached body when present', async () => {
		// The an handler uses 'an/<filename>' as cache key.
		// normalizeEdgeCacheKey converts it to 'https://edge-cache.local/an/<filename>'.
		const edgeKey = 'https://edge-cache.local/an/demo-edge';
		await caches.default.put(edgeKey, new Response('EDGE-AN', {
			headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'text/plain; charset=utf-8' }
		}));

		const env = makeEnv();
		const { res } = await request('/api/an/demo-edge.an', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('EDGE-AN');

		// Clean up to keep test isolation
		await caches.default.delete(edgeKey);
	});

	it('HEAD on edge-cached an returns empty body', async () => {
		const edgeKey = 'https://edge-cache.local/an/demo-edge-head';
		await caches.default.put(edgeKey, new Response('EDGE-AN', {
			headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'text/plain; charset=utf-8' }
		}));
		const env = makeEnv();
		const { res } = await request('/api/an/demo-edge-head.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
		await caches.default.delete(edgeKey);
	});
});

describe('edge cache hits for /api/md/*.md', () => {
	it('serves an edge-cached body and ignores R2/DB', async () => {
		const edgeKey = 'https://edge-cache.local/md/demo-edge-md';
		await caches.default.put(edgeKey, new Response('EDGE-MD', {
			headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'text/markdown; charset=utf-8' }
		}));

		const env = makeEnv();
		const { res } = await request('/api/md/demo-edge-md.md', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('EDGE-MD');
		await caches.default.delete(edgeKey);
	});
});
