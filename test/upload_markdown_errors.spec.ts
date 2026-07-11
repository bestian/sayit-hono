import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function createEnv(options: { failDb?: boolean } = {}) {
	return {
		AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
		BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
		ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
		SPEECH_CACHE: {
			delete: async () => true,
			get: async () => null,
			put: async () => {},
			list: async () => ({ objects: [], truncated: false, cursor: '' }),
		},
		DB: {
			prepare: () => ({
				bind: () => ({
					first: async () => {
						if (options.failDb) throw new Error('retry me');
						return null;
					},
					all: async () => {
						if (options.failDb) throw new Error('retry me');
						return { success: true, results: [] };
					},
					run: async () => {
						if (options.failDb) throw new Error('retry me');
						return { success: true, meta: { changes: 1 } };
					},
				}),
				first: async () => null,
				all: async () => ({ success: true, results: [] }),
				run: async () => ({ success: true, meta: { changes: 1 } }),
			}),
			batch: async () => {
				if (options.failDb) throw new Error('retry me');
				return [];
			},
		},
	};
}

async function request(path: string, init: RequestInit<IncomingRequestCfProperties>, env = createEnv()) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('upload_markdown — unsupported method', () => {
	it('returns 400 for PUT (not POST/PATCH/DELETE)', async () => {
		const env = createEnv();
		const { res } = await request(
			'/api/upload_markdown',
			{
				method: 'PUT',
				headers: {
					Authorization: 'Bearer token-audrey',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ filename: 'x', markdown: 'y' }),
			},
			env,
		);
		expect(res.status).toBe(404);
	});

	it('returns 400 for invalid JSON on PATCH', async () => {
		const env = createEnv();
		const { res } = await request(
			'/api/upload_markdown',
			{
				method: 'PATCH',
				headers: {
					Authorization: 'Bearer token-audrey',
					'Content-Type': 'application/json',
				},
				body: '{not json',
			},
			env,
		);
		expect(res.status).toBe(400);
	});

	it('returns 400 when PATCH is missing filename', async () => {
		const env = createEnv();
		const { res } = await request(
			'/api/upload_markdown',
			{
				method: 'PATCH',
				headers: {
					Authorization: 'Bearer token-audrey',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ markdown: '# x\ny' }),
			},
			env,
		);
		expect(res.status).toBe(400);
	});

	it('returns 400 when PATCH is missing markdown', async () => {
		const env = createEnv();
		const { res } = await request(
			'/api/upload_markdown',
			{
				method: 'PATCH',
				headers: {
					Authorization: 'Bearer token-audrey',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ filename: 'x' }),
			},
			env,
		);
		expect(res.status).toBe(400);
	});
});

describe('upload_markdown — 503 on DB failure', () => {
	it('returns 503 with Retry-After when DB retry ultimately fails', async () => {
		const env = createEnv({ failDb: true });
		const { res } = await request(
			'/api/upload_markdown?filename=demo',
			{
				method: 'DELETE',
				headers: { Authorization: 'Bearer token-audrey' },
			},
			env,
		);
		expect(res.status).toBe(503);
		expect(res.headers.get('Retry-After')).toBe('2');
	}, 15000);
});
