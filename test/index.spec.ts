import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function createEnv() {
	const okPaths = new Set([
		'/about',
		'/about/',
		'/favicon.ico',
		'/robots.txt'
	]);
	const r2Store = new Map<string, { body: string; cacheControl?: string; contentType?: string }>();

	return {
		__r2Store: r2Store,
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
			prepare: (sql: string) => {
				const run = (args: unknown[]) => ({
					first: async () => {
						if (sql.includes('FROM speech_index WHERE filename = ?')) {
							if (args[0] === '2026-03-24-demo-speech') {
								return {
									filename: '2026-03-24-demo-speech',
									display_name: '2026-03-24 Demo Speech',
									isNested: 0,
									nest_filenames: null,
									nest_display_names: null
								};
							}
							return null;
						}

						if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
							return null;
						}

						return null;
					},
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

						if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?')) {
							if (args[0] === '2026-03-24-demo-speech') {
								return {
									success: true,
									results: [
										{
											filename: '2026-03-24-demo-speech',
											section_id: 101,
											previous_section_id: null,
											next_section_id: 102,
											section_speaker: 'audrey-tang',
											section_content: '<p>First paragraph.</p>',
											photoURL: null,
											name: 'Audrey Tang'
										},
										{
											filename: '2026-03-24-demo-speech',
											section_id: 102,
											previous_section_id: 101,
											next_section_id: null,
											section_speaker: 'audrey-tang',
											section_content: '<p>Second paragraph.</p>',
											photoURL: null,
											name: 'Audrey Tang'
										}
									]
								};
							}
							return { success: true, results: [] };
						}

						return {
							success: true,
							results: [{ filename: 'demo.an', display_name: 'Demo Speech' }]
						};
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

async function request(path: string, env = createEnv()) {
	const req = new IncomingRequest(`https://example.com${path}`);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env, ctx);
	return { res, ctx };
}

describe('Worker routes', () => {
	it.each(['/about', '/about/'])('serves static asset: %s', async (path) => {
		const { res } = await request(path);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('asset:');
	});

	it('renders the home page', async () => {
		const { res } = await request('/');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('SayIt');
	});

	it('redirects speeches to the canonical trailing-slash URL', async () => {
		const { res } = await request('/speeches');
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/speeches/');
	});

	it('strips ignored query params from the speeches page URL', async () => {
		const { res } = await request('/speeches?x');
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/speeches/');
	});

	it('returns speech index from D1', async () => {
		const { res } = await request('/api/speech_index.json');
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual([
			expect.objectContaining({ filename: 'demo.an', display_name: 'Demo Speech' })
		]);
	});

	it('returns an RSS feed', async () => {
		const { res } = await request('/rss.xml');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/rss+xml');

		const xml = await res.text();
		expect(xml).toContain('<rss version="2.0"');
		expect(xml).toContain('<title>SayIt</title>');
		expect(xml).toContain('<title>2026-03-01 Demo Speech</title>');
		expect(xml).toContain('<link>https://archive.tw/2026-03-01-demo-speech</link>');
		expect(xml).toContain('<description>Audrey Tang: Demo summary for the RSS feed.</description>');
	});

	it('returns 404 for unknown path', async () => {
		const { res } = await request('/not-found');
		expect(res.status).toBe(404);
	});

	it('redirects query variants of speech pages to the canonical URL before caching', async () => {
		const env = createEnv();

		const first = await request('/2026-03-24-demo-speech', env);
		expect(first.res.status).toBe(200);

		const second = await request('/2026-03-24-demo-speech?x', env);
		expect(second.res.status).toBe(302);
		expect(second.res.headers.get('location')).toBe('https://example.com/2026-03-24-demo-speech');

		const keys = Array.from((env as any).__r2Store.keys()) as string[];
		expect(keys).toContain(`${CACHE_KEY_VERSION}/example.com/2026-03-24-demo-speech`);
		expect(keys).not.toContain(`${CACHE_KEY_VERSION}/example.com/2026-03-24-demo-speech?x`);
		expect(keys.filter((key) => key.includes('2026-03-24-demo-speech'))).toHaveLength(1);
	});
});
