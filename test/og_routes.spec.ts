import { describe, expect, it, vi } from 'vite-plus/test';
import { handleOgImage, handleOgSpeechImage, type OgGenerators, type OgLoader } from '../src/api/og_routes';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import type { Context } from 'hono';
import type { ApiEnv } from '../src/api/types';

type R2Entry = { body: Uint8Array | string; contentType?: string; cacheControl?: string };
type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function makeContext(options: {
	url: string;
	params?: Record<string, string | undefined>;
	resolver: Resolver;
	r2?: Record<string, R2Entry>;
	assetsFetch?: (req: Request) => Response | Promise<Response>;
}): { ctx: Context<ApiEnv>; r2Store: Map<string, R2Entry>; puts: Array<{ key: string; body: unknown; opts?: any }> } {
	const r2Store = new Map<string, R2Entry>();
	for (const [k, v] of Object.entries(options.r2 ?? {})) r2Store.set(k, v);
	const puts: Array<{ key: string; body: unknown; opts?: any }> = [];

	const ctx = {
		req: {
			url: options.url,
			method: 'GET',
			header: (_: string) => null,
			param: (name: string) => options.params?.[name],
		},
		env: {
			SPEECH_CACHE: {
				get: async (key: string) => r2Store.get(key) ?? null,
				put: async (key: string, body: unknown, opts?: any) => {
					puts.push({ key, body, opts });
					r2Store.set(key, {
						body: body as any,
						contentType: opts?.httpMetadata?.contentType,
						cacheControl: opts?.httpMetadata?.cacheControl,
					});
				},
				delete: async () => true,
			},
			ASSETS: {
				fetch: (req: Request) => {
					if (options.assetsFetch) return options.assetsFetch(req);
					return new Response('Not Found', { status: 404 });
				},
			} as unknown as Fetcher,
			DB: {
				prepare: (sql: string) => {
					// Defer the resolver call into a microtask so a `throw` inside the
					// resolver becomes a Promise rejection only AFTER the SUT's `await`
					// has attached itself as awaiter — see notes in og_cache.spec.ts.
					const callResolver = (args: unknown[]) =>
						new Promise<ReturnType<Resolver>>((resolve, reject) => {
							queueMicrotask(() => {
								try {
									resolve(options.resolver(sql, args));
								} catch (err) {
									reject(err);
								}
							});
						});
					return {
						bind: (...args: unknown[]) => ({
							first: async () => (await callResolver(args)).results[0] ?? null,
							all: async () => {
								const r = await callResolver(args);
								return { success: r.success ?? true, results: r.results };
							},
						}),
						first: async () => (await callResolver([])).results[0] ?? null,
						all: async () => {
							const r = await callResolver([]);
							return { success: r.success ?? true, results: r.results };
						},
					};
				},
			},
		},
		text: (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers }),
		json: (body: any, status = 200, headers: Record<string, string> = {}) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'Content-Type': 'application/json', ...headers },
			}),
	} as unknown as Context<ApiEnv>;

	return { ctx, r2Store, puts };
}

function createFakeGenerators(overrides: Partial<OgGenerators> = {}): OgLoader {
	const gen: OgGenerators = {
		generateQuoteOgImage: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
		generateOgImage: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
		...overrides,
	};
	return async () => gen;
}

describe('handleOgSpeechImage', () => {
	const sectionRow = {
		filename: '2026-demo',
		section_speaker: 'audrey-tang',
		section_content: '<p>Hello quote</p>',
		display_name: 'Demo',
		photoURL: null,
		name: 'Audrey',
	};

	it('returns 404 when the section id is not an integer', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/x.png',
			params: { section_id: 'x.png' },
			resolver: () => ({ success: true, results: [] }),
		});
		const res = await handleOgSpeechImage(ctx, createFakeGenerators());
		expect(res.status).toBe(404);
	});

	it('returns cached PNG when SPEECH_CACHE has it', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/og/speech/42.png`;
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: () => ({ success: true, results: [] }),
			r2: { [cacheKey]: { body: new Uint8Array([1, 2, 3]), contentType: 'image/png' } },
		});
		const res = await handleOgSpeechImage(ctx, createFakeGenerators());
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/png');
	});

	it('returns 500 when loadSection throws', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql) => {
				if (sql.includes('FROM speech_content a')) throw new Error('boom');
				return { success: true, results: [] };
			},
		});
		const res = await handleOgSpeechImage(ctx, createFakeGenerators());
		expect(res.status).toBe(500);
	});

	it('returns 404 when the section is missing', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: () => ({ success: true, results: [] }),
		});
		const res = await handleOgSpeechImage(ctx, createFakeGenerators());
		expect(res.status).toBe(404);
	});

	it('generates the PNG, stores it in R2, and returns it', async () => {
		const { ctx, puts } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return { success: true, results: [sectionRow] };
				}
				return { success: true, results: [] };
			},
		});

		const generator = vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
		const res = await handleOgSpeechImage(ctx, createFakeGenerators({ generateQuoteOgImage: generator }));

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/png');
		expect(generator).toHaveBeenCalledWith('<p>Hello quote</p>', 'Audrey', 'Demo', null);
		expect(puts).toHaveLength(1);
		expect(puts[0].key).toBe(`${CACHE_KEY_VERSION}/og/speech/42.png`);
	});

	it('falls back to filename when display_name is missing', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return {
						success: true,
						results: [{ ...sectionRow, display_name: null, name: null }],
					};
				}
				return { success: true, results: [] };
			},
		});
		const generator = vi.fn(async () => new Uint8Array([0x89]));
		await handleOgSpeechImage(ctx, createFakeGenerators({ generateQuoteOgImage: generator }));
		expect(generator).toHaveBeenCalledWith('<p>Hello quote</p>', null, '2026-demo', null);
	});

	it('treats null section_content as an empty string', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return {
						success: true,
						results: [{ ...sectionRow, section_content: null }],
					};
				}
				return { success: true, results: [] };
			},
		});
		const generator = vi.fn(async () => new Uint8Array([0x89]));
		await handleOgSpeechImage(ctx, createFakeGenerators({ generateQuoteOgImage: generator }));
		expect(generator).toHaveBeenCalledWith('', 'Audrey', 'Demo', null);
	});

	it('returns 500 when the generator throws', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return { success: true, results: [sectionRow] };
				}
				return { success: true, results: [] };
			},
		});

		const res = await handleOgSpeechImage(
			ctx,
			createFakeGenerators({
				generateQuoteOgImage: async () => {
					throw new Error('satori failed');
				},
			}),
		);
		expect(res.status).toBe(500);
	});

	it('encodes avatar data URI from ASSETS when photoURL is present', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return {
						success: true,
						results: [{ ...sectionRow, photoURL: '/media/a.jpg' }],
					};
				}
				return { success: true, results: [] };
			},
			assetsFetch: (req) => {
				if (req.url.endsWith('/media/a.jpg')) {
					return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
						status: 200,
						headers: { 'Content-Type': 'image/jpeg' },
					});
				}
				return new Response('not found', { status: 404 });
			},
		});

		const generator = vi.fn<OgGenerators['generateQuoteOgImage']>(async () => new Uint8Array([0x89]));
		await handleOgSpeechImage(ctx, createFakeGenerators({ generateQuoteOgImage: generator }));
		const avatarArg = generator.mock.calls[0]![3];
		expect(avatarArg).toMatch(/^data:image\/jpeg;base64,/);
	});

	it('silently falls back to null avatar when ASSETS returns non-OK', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return { success: true, results: [{ ...sectionRow, photoURL: '/media/missing.jpg' }] };
				}
				return { success: true, results: [] };
			},
			assetsFetch: () => new Response('nope', { status: 404 }),
		});
		const generator = vi.fn<OgGenerators['generateQuoteOgImage']>(async () => new Uint8Array([0x89]));
		await handleOgSpeechImage(ctx, createFakeGenerators({ generateQuoteOgImage: generator }));
		expect(generator.mock.calls[0]![3]).toBeNull();
	});

	it('silently falls back to null avatar when ASSETS throws', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return { success: true, results: [{ ...sectionRow, photoURL: '/media/broken.jpg' }] };
				}
				return { success: true, results: [] };
			},
			assetsFetch: () => {
				throw new Error('asset fetch exploded');
			},
		});
		const generator = vi.fn<OgGenerators['generateQuoteOgImage']>(async () => new Uint8Array([0x89]));
		await handleOgSpeechImage(ctx, createFakeGenerators({ generateQuoteOgImage: generator }));
		expect(generator.mock.calls[0]![3]).toBeNull();
	});
});

describe('handleOgImage', () => {
	const speechMeta = { filename: '2026-demo', display_name: 'Demo Speech', isNested: 0 };

	function resolver(withSpeakers = true): Resolver {
		return (sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === '2026-demo') return { success: true, results: [speechMeta] };
				return { success: true, results: [] };
			}
			if (sql.includes('GROUP BY sp.name')) {
				if (!withSpeakers) throw new Error('boom');
				return {
					success: true,
					results: [
						{ name: 'Audrey', first_appearance: 1 },
						{ name: 'Bestian', first_appearance: 2 },
					],
				};
			}
			return { success: true, results: [] };
		};
	}

	it('returns 404 when decoded filename is empty', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/.png',
			resolver: () => ({ success: true, results: [] }),
		});
		const res = await handleOgImage(ctx, createFakeGenerators());
		expect(res.status).toBe(404);
	});

	it('returns cached PNG when SPEECH_CACHE has it', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/og/2026-demo.png`;
		const { ctx } = makeContext({
			url: 'https://example.com/og/2026-demo.png',
			resolver: resolver(),
			r2: { [cacheKey]: { body: new Uint8Array([1, 2]), contentType: 'image/png' } },
		});
		const res = await handleOgImage(ctx, createFakeGenerators());
		expect(res.status).toBe(200);
	});

	it('returns 404 when speech meta is missing', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/unknown.png',
			resolver: resolver(),
		});
		const res = await handleOgImage(ctx, createFakeGenerators());
		expect(res.status).toBe(404);
	});

	it('generates PNG and stores it in R2', async () => {
		const { ctx, puts } = makeContext({
			url: 'https://example.com/og/2026-demo.png',
			resolver: resolver(),
		});
		const generator = vi.fn(async () => new Uint8Array([0x89, 0x50]));
		const res = await handleOgImage(ctx, createFakeGenerators({ generateOgImage: generator }));
		expect(res.status).toBe(200);
		expect(generator).toHaveBeenCalledWith(ctx.env, '2026-demo', 'Demo Speech', ['Audrey', 'Bestian']);
		expect(puts[0].key).toBe(`${CACHE_KEY_VERSION}/og/2026-demo.png`);
	});

	it('proceeds with empty speaker list when speakers query throws', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/2026-demo.png',
			resolver: resolver(false),
		});
		const generator = vi.fn(async () => new Uint8Array([0x89]));
		await handleOgImage(ctx, createFakeGenerators({ generateOgImage: generator }));
		expect(generator).toHaveBeenCalledWith(ctx.env, '2026-demo', 'Demo Speech', []);
	});

	it('returns 500 when the generator throws', async () => {
		const { ctx } = makeContext({
			url: 'https://example.com/og/2026-demo.png',
			resolver: resolver(),
		});
		const res = await handleOgImage(
			ctx,
			createFakeGenerators({
				generateOgImage: async () => {
					throw new Error('satori failed');
				},
			}),
		);
		expect(res.status).toBe(500);
	});
});
