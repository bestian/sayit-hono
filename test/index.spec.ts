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
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();

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
		SPEECH_CACHE: {
			get: async (key: string) => {
				const entry = r2Store.get(key);
				if (!entry) return null;
				return {
					size: entry.body.length,
					httpEtag: null,
					httpMetadata: {
						cacheControl: entry.cacheControl,
						contentType: entry.contentType
					},
					text: async () => entry.body
				};
			},
			put: async (
				key: string,
				body: string,
				options?: { httpMetadata?: { cacheControl?: string; contentType?: string } }
			) => {
				r2Store.set(key, {
					body,
					cacheControl: options?.httpMetadata?.cacheControl,
					contentType: options?.httpMetadata?.contentType
				});
			}
		},
		DB: {
			prepare: (sql: string) => ({
				bind: (...args: unknown[]) => ({
					all: async () => {
						if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
							const limit = Number(args[0] ?? 30);
							return {
								success: true,
								results: [
									{
										id: 1,
										filename: '2026-03-01-demo-speech',
										display_name: '2026-03-01 Demo Speech',
										isNested: 0,
										first_nest_filename: null,
										first_nest_display_name: null,
										first_section_content: '<p>Demo summary for the RSS feed.</p>',
										first_speaker_name: 'Audrey Tang'
									}
								].slice(0, limit)
							};
						}

						return {
							success: true,
							results: [{ filename: 'demo.an', display_name: 'Demo Speech' }]
						};
					}
				}),
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

	it('returns an RSS feed', async () => {
		const { res } = await request('/rss.xml');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/rss+xml');

		const xml = await res.text();
		expect(xml).toContain('<rss version="2.0"');
		expect(xml).toContain('<title>SayIt</title>');
		expect(xml).toContain('<title>2026-03-01 Demo Speech</title>');
		expect(xml).toContain('<link>https://sayit.archive.tw/2026-03-01-demo-speech</link>');
		expect(xml).toContain('<description>Audrey Tang: Demo summary for the RSS feed.</description>');
	});

	it('returns 404 for unknown path', async () => {
		const { res } = await request('/not-found');
		expect(res.status).toBe(404);
	});
});
