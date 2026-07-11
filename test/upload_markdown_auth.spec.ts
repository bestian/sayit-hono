import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function createAuthEnv() {
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
			prepare: () => {
				throw new Error('DB should never be queried when auth fails');
			},
			batch: async () => {
				throw new Error('DB should never be batched when auth fails');
			},
		},
	};
}

async function request(path: string, init: RequestInit<IncomingRequestCfProperties>) {
	const env = createAuthEnv();
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

const mutationMethods = ['POST', 'PATCH', 'DELETE'] as const;

describe('/api/upload_markdown — auth gate', () => {
	for (const method of mutationMethods) {
		describe(method, () => {
			const path = method === 'DELETE' ? '/api/upload_markdown?filename=x' : '/api/upload_markdown';
			const body = method === 'DELETE' ? undefined : JSON.stringify({ filename: 'x', markdown: '# x\ny' });
			const contentType = method === 'DELETE' ? undefined : 'application/json; charset=utf-8';

			it('rejects missing Authorization header with 400', async () => {
				const { res } = await request(path, {
					method,
					headers: contentType ? { 'Content-Type': contentType } : {},
					body,
				});
				expect(res.status).toBe(400);
			});

			it('rejects non-Bearer scheme with 400', async () => {
				const { res } = await request(path, {
					method,
					headers: {
						Authorization: 'Basic token-audrey',
						...(contentType ? { 'Content-Type': contentType } : {}),
					},
					body,
				});
				expect(res.status).toBe(400);
			});

			it('rejects unknown token with 400', async () => {
				const { res } = await request(path, {
					method,
					headers: {
						Authorization: 'Bearer not-a-real-token',
						...(contentType ? { 'Content-Type': contentType } : {}),
					},
					body,
				});
				expect(res.status).toBe(400);
			});

			it('rejects empty Bearer with 400', async () => {
				const { res } = await request(path, {
					method,
					headers: {
						Authorization: 'Bearer ',
						...(contentType ? { 'Content-Type': contentType } : {}),
					},
					body,
				});
				expect(res.status).toBe(400);
			});
		});
	}
});

describe('/api/purge_cache — auth gate', () => {
	it('rejects missing Authorization with 403', async () => {
		const { res } = await request('/api/purge_cache', { method: 'POST' });
		expect(res.status).toBe(403);
	});

	it('rejects unknown token with 403', async () => {
		const { res } = await request('/api/purge_cache', {
			method: 'POST',
			headers: { Authorization: 'Bearer wrong' },
		});
		expect(res.status).toBe(403);
	});

	it('rejects non-Bearer scheme with 403', async () => {
		const { res } = await request('/api/purge_cache', {
			method: 'POST',
			headers: { Authorization: 'Basic token-audrey' },
		});
		expect(res.status).toBe(403);
	});
});
