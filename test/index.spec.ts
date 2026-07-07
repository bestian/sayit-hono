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
		AUDREYT_TRANSCRIPT_TOKEN: 'test-audrey',
		BESTIAN_TRANSCRIPT_TOKEN: 'test-bestian',
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
			},
			delete: async (keys: string | string[]) => {
				for (const key of Array.isArray(keys) ? keys : [keys]) {
					r2Store.delete(key);
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

						if (sql.includes('SELECT id, route_pathname, name FROM speakers WHERE id = ?')) {
							if (args[0] === 16224) {
								return {
									id: 16224,
									route_pathname: 'Yoichi%20Ochiai',
									name: 'Yoichi Ochiai'
								};
							}
							return null;
						}

						if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
							if (args[0] === 'ochiai') {
								return { count: 1 };
							}
							return { count: 0 };
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

						if (sql.includes('instr(lower(COALESCE(si.display_name') && sql.includes('FROM speech_content sc')) {
							if (args[0] === 'ochiai') {
								return {
									success: true,
									results: [
										{
											filename: '2026-03-25-weekly-ochiai',
											nest_filename: null,
											display_name: '2026-03-25 Weekly Ochiai',
											section_id: 638607,
											section_speaker: 'Yoichi%20Ochiai',
											section_content: '<p>We&#39;re shifting from &quot;data oil&quot; to &quot;data soil.&quot;</p>',
											speaker_name: 'Yoichi Ochiai',
											photoURL: null
										}
									]
								};
							}
							return { success: true, results: [] };
						}

						if (sql.includes('FROM speakers') && sql.includes('instr(lower(COALESCE(name')) {
							if (args[0] === 'ochiai') {
								return {
									success: true,
									results: [
										{
											id: 16224,
											route_pathname: 'Yoichi%20Ochiai',
											name: 'Yoichi Ochiai',
											photoURL: null
										}
									]
								};
							}
							return { success: true, results: [] };
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

async function request(path: string, env = createEnv(), init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
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

	it('renders the privacy page through the worker route', async () => {
		const { res } = await request('/privacy');

		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400');
		const html = await res.text();
		expect(html).toContain('<title> Privacy Policy :: SayIt </title>');
		expect(html).toContain('content="Privacy policy for AI questions on SayIt."');
		expect(html).toContain('id="privacy-zh"');
		expect(html).toContain('We do not sell or exchange your personal data');
		expect(html).toContain('href="/terms"');
	});

	it('renders the terms page through the worker route', async () => {
		const { res } = await request('/terms');

		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400');
		const html = await res.text();
		expect(html).toContain('<title> Terms of Use :: SayIt </title>');
		expect(html).toContain('content="Terms of use for AI questions on SayIt."');
		expect(html).toContain('id="terms-zh"');
		expect(html).toContain('Content provided in AI replies is licensed under Creative Commons Attribution-ShareAlike');
		expect(html).toContain('href="/privacy"');
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

	it('renders speeches from D1 and writes a data-versioned R2 HTML cache', async () => {
		const env = createEnv();
		const { res } = await request('/speeches/', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400');
		expect(await res.text()).toContain('Demo Speech');
		const speechCacheKeys = Array.from(env.__r2Store.keys()).filter((key) =>
			key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`)
		);
		expect(speechCacheKeys).toHaveLength(1);
	});

	it('returns speech index from D1', async () => {
		const { res } = await request('/api/speech_index.json');
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual([
			expect.objectContaining({ filename: 'demo.an', display_name: 'Demo Speech' })
		]);
	});

	it('returns transcript search results from D1', async () => {
		const { res } = await request('/api/search.json?q=ochiai');
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			results: [
				expect.objectContaining({
					title: '2026-03-25 Weekly Ochiai',
					url: '/2026-03-25-weekly-ochiai#s638607',
					speaker: 'Yoichi Ochiai',
					snippet: 'We\'re shifting from "data oil" to "data soil."'
				})
			]
		});
	});

	it('renders scoped speaker search results without stripping query params', async () => {
		const redirected = await request('/search?q=ochiai&p=16224');
		expect(redirected.res.status).toBe(302);
		expect(redirected.res.headers.get('location')).toBe('https://example.com/search/?q=ochiai&p=16224');

		const { res } = await request('/search/?q=ochiai&p=16224');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('Search this person\'s speeches');
		expect(html).toContain('2026-03-25 Weekly Ochiai');
		expect(html).toContain('Yoichi Ochiai');
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

	describe('POST /api/cleanup_old_cache', () => {
		it('sweeps keys outside current cache version and preserves current', async () => {
			const env = createEnv();
			(env as any).__r2Store.set(`${CACHE_KEY_VERSION}/example.com/keep-1`, { body: 'current' });
			(env as any).__r2Store.set(`${CACHE_KEY_VERSION}/example.com/keep-2`, { body: 'current' });
			(env as any).__r2Store.set('v-old1/example.com/legacy-1', { body: 'old' });
			(env as any).__r2Store.set('v-old2/example.com/legacy-2', { body: 'old' });
			(env as any).__r2Store.set('archive.tw/unversioned', { body: 'legacy' });

			const { res } = await request('/api/cleanup_old_cache', env, {
				method: 'POST',
				headers: { Authorization: 'Bearer test-audrey' }
			});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ deleted: 3, more: false });
			expect((env as any).__r2Store.has(`${CACHE_KEY_VERSION}/example.com/keep-1`)).toBe(true);
			expect((env as any).__r2Store.has(`${CACHE_KEY_VERSION}/example.com/keep-2`)).toBe(true);
			expect((env as any).__r2Store.has('v-old1/example.com/legacy-1')).toBe(false);
			expect((env as any).__r2Store.has('v-old2/example.com/legacy-2')).toBe(false);
			expect((env as any).__r2Store.has('archive.tw/unversioned')).toBe(false);
		});

		it('returns more:true when max_deletes cap is hit', async () => {
			const env = createEnv();
			for (let i = 0; i < 5; i++) {
				(env as any).__r2Store.set(`v-old/example.com/legacy-${i}`, { body: 'old' });
			}

			const { res } = await request('/api/cleanup_old_cache?max_deletes=2', env, {
				method: 'POST',
				headers: { Authorization: 'Bearer test-audrey' }
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as { deleted: number; more: boolean };
			expect(body.more).toBe(true);
			expect(body.deleted).toBeGreaterThanOrEqual(2);
		});

		it('accepts bestian token', async () => {
			const env = createEnv();
			(env as any).__r2Store.set('v-old/example.com/legacy', { body: 'old' });

			const { res } = await request('/api/cleanup_old_cache', env, {
				method: 'POST',
				headers: { Authorization: 'Bearer test-bestian' }
			});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ deleted: 1, more: false });
		});

		it('rejects missing Authorization with 403', async () => {
			const env = createEnv();
			const { res } = await request('/api/cleanup_old_cache', env, { method: 'POST' });
			expect(res.status).toBe(403);
		});

		it('rejects non-Bearer scheme with 403', async () => {
			const env = createEnv();
			const { res } = await request('/api/cleanup_old_cache', env, {
				method: 'POST',
				headers: { Authorization: 'Basic test-audrey' }
			});
			expect(res.status).toBe(403);
		});

		it('rejects unknown token with 403', async () => {
			const env = createEnv();
			const { res } = await request('/api/cleanup_old_cache', env, {
				method: 'POST',
				headers: { Authorization: 'Bearer wrong-token' }
			});
			expect(res.status).toBe(403);
		});
	});
});
