import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function createEnv() {
	const okPaths = new Set([
		'/',
		'/index.html',
		'/speeches',
		'/speeches.html',
		'/speeches/',
		'/speeches/index.html',
		'/favicon.ico',
		'/robots.txt'
	]);

	return {
		ASSETS: {
			// 僅對已知靜態路徑回傳 200，其餘回傳 404
			fetch: (url: string) => {
				const pathname = new URL(url).pathname;
				if (okPaths.has(pathname)) {
					return new Response(`asset:${pathname}`, { status: 200 });
				}
				return new Response('Not Found', { status: 404 });
			}
		},
		DB: {
			prepare: () => ({
				all: async () => ({
					success: true,
					results: [{ filename: 'demo.an', display_name: 'Demo Speech' }]
				})
			})
		}
	};
}

async function request(path: string, env = createEnv()) {
	const req = new IncomingRequest(`https://example.com${path}`);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env, ctx);
	return { res, ctx };
}

describe('Worker routes', () => {
	it.each(['/', '/about', '/about/', '/speeches', '/speeches/'])('serves static asset: %s', async (path) => {
		const { res } = await request(path);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('asset:');
	});

	it('returns speech index from D1', async () => {
		const { res } = await request('/api/speech_index.json');
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual([{ filename: 'demo.an', display_name: 'Demo Speech' }]);
	});

	it('returns 404 for unknown path', async () => {
		const { res } = await request('/not-found');
		expect(res.status).toBe(404);
	});
});
