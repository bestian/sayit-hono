import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('og speech R2 hit tagging', () => {
	it('sets Cache-Tag when sections lookup returns filename', async () => {
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const env = {
			AUDREYT_TRANSCRIPT_TOKEN: 'x',
			BESTIAN_TRANSCRIPT_TOKEN: 'y',
			ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
			SPEECH_CACHE: {
				get: async (key: string) => {
					if (key === `${CACHE_KEY_VERSION}/og/speech/7.png`) {
						return { body: png, arrayBuffer: async () => png.buffer };
					}
					return null;
				},
				put: async () => {},
				delete: async () => true,
				list: async () => ({ objects: [], truncated: false, cursor: '' }),
			},
			DB: {
				prepare: (sql: string) => ({
					bind: (..._args: unknown[]) => ({
						first: async () => {
							if (sql.includes('FROM sections WHERE section_id')) {
								return { filename: 'demo-speech' };
							}
							return null;
						},
						all: async () => ({ success: true, results: [] }),
					}),
					first: async () => null,
					all: async () => ({ success: true, results: [] }),
				}),
			},
		};
		const req = new IncomingRequest('https://example.com/og/speech/7.png');
		const res = await worker.fetch(req, env as any, createExecutionContext());
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Tag')).toContain('speech:');
	});

	it('still serves cached PNG when sections lookup throws', async () => {
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const env = {
			AUDREYT_TRANSCRIPT_TOKEN: 'x',
			BESTIAN_TRANSCRIPT_TOKEN: 'y',
			ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
			SPEECH_CACHE: {
				get: async (key: string) => {
					if (key === `${CACHE_KEY_VERSION}/og/speech/8.png`) {
						return { body: png, arrayBuffer: async () => png.buffer };
					}
					return null;
				},
				put: async () => {},
				delete: async () => true,
				list: async () => ({ objects: [], truncated: false, cursor: '' }),
			},
			DB: {
				prepare: () => ({
					bind: () => ({
						first: async () => {
							throw new Error('db down');
						},
						all: async () => ({ success: true, results: [] }),
					}),
					first: async () => {
						throw new Error('db down');
					},
					all: async () => ({ success: true, results: [] }),
				}),
			},
		};
		const req = new IncomingRequest('https://example.com/og/speech/8.png');
		const res = await worker.fetch(req, env as any, createExecutionContext());
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('image/png');
	});
});
