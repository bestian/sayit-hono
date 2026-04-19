import { describe, expect, it } from 'vitest';
import { getAnContentAsString, serveAnByKey, speechAn } from '../src/api/an';
import { speakerDetail } from '../src/api/speaker_detail';
import { speechIndex } from '../src/api/speech_index';
import { docsFromMarkdown } from '../src/search/docBuilder';
import { reorderSections, type SectionLike } from '../src/utils/sectionUtils';
import { handleOgSpeechImage, type OgLoader } from '../src/api/og_routes';
import type { Context } from 'hono';
import type { ApiEnv } from '../src/api/types';

function makeCtx(overrides: Partial<{
	method: string;
	url: string;
	path: string;
	param: string | undefined;
	origin: string | null;
	resolver: (sql: string, args: unknown[]) => { success?: boolean; results: any[] };
	sectionRow: any;
}> = {}) {
	const resolver = overrides.resolver ?? (() => ({ success: true, results: [] }));
	return {
		req: {
			method: overrides.method ?? 'GET',
			url: overrides.url ?? 'https://example.com/api/an/demo.an',
			path: overrides.path ?? '/api/an/demo.an',
			header: (k: string) => (k === 'Origin' ? overrides.origin ?? null : null),
			param: (_: string) => overrides.param
		},
		env: {
			SPEECH_CACHE: {
				get: async () => null,
				put: async () => {},
				delete: async () => true
			},
			ASSETS: { fetch: () => new Response('nf', { status: 404 }) } as any,
			DB: {
				prepare: (sql: string) => {
					const run = (args: unknown[]) => ({
						first: async () => resolver(sql, args).results[0] ?? null,
						all: async () => {
							const r = resolver(sql, args);
							return { success: r.success ?? true, results: r.results };
						}
					});
					return {
						bind: (...args: unknown[]) => run(args),
						first: async () => run([]).first(),
						all: async () => run([]).all()
					};
				}
			}
		},
		text: (body: string, status = 200, headers: Record<string, string> = {}) =>
			new Response(body, { status, headers }),
		json: (body: any, status = 200, headers: Record<string, string> = {}) =>
			new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
	} as unknown as Context<ApiEnv>;
}

describe('an.ts parseContent branches via JSON-encoded string content', () => {
	it('returns the unwrapped string when section_content is valid JSON-string', async () => {
		// JSON.parse('"hello"') → 'hello' (string). parseContent returns the parsed string.
		const out = await getAnContentAsString(
			makeCtx({
				resolver: (sql) => {
					if (sql.includes('FROM sections WHERE section_id = ?')) {
						return {
							success: true,
							results: [{
								section_speaker: 'a',
								section_content: '"hello world"',
								display_name: 'Demo',
								name: 'A'
							}]
						};
					}
					return { success: true, results: [] };
				}
			}),
			'42.an'
		);
		expect(out).toContain('hello world');
		expect(out).not.toContain('"hello world"');
	});

	it('returns empty body when section content is null (parseContent falsy branch)', async () => {
		const out = await getAnContentAsString(
			makeCtx({
				resolver: (sql) => {
					if (sql.includes('FROM sections WHERE section_id = ?')) {
						return {
							success: true,
							results: [{
								section_speaker: null,
								section_content: null,
								display_name: null,
								name: null
							}]
						};
					}
					return { success: true, results: [] };
				}
			}),
			'42.an'
		);
		expect(out).toContain('<p></p>');
	});
});

describe('speechAn getSpeechObjectKey branches', () => {
	it('returns 404 when path decode succeeds but key is empty (no extension)', async () => {
		// getSpeechObjectKey('/api/an/.an') → key='.an' → ends with .an → returns '.an' → speechAn
		// tries to decode again, then passes to serveAnByKey which treats base as empty.
		const res = await speechAn(makeCtx({ param: undefined, path: '/api/an/plain' }));
		expect(res.status).toBe(404);
	});

	it('returns 404 when path does not start with /api/an/ prefix', async () => {
		const res = await speechAn(makeCtx({ param: undefined, path: '/other/route' }));
		expect(res.status).toBe(404);
	});

	it('returns 404 when path is empty', async () => {
		const res = await speechAn(makeCtx({ param: undefined, path: '' }));
		expect(res.status).toBe(404);
	});

	it('returns 404 when path equals "/"', async () => {
		const res = await speechAn(makeCtx({ param: undefined, path: '/' }));
		expect(res.status).toBe(404);
	});

	it('returns 404 when decoded path does not end with .an', async () => {
		const res = await speechAn(makeCtx({ param: undefined, path: '/api/an/notenough' }));
		expect(res.status).toBe(404);
	});

	it('decodes a valid URI-encoded path param when the route provides it', async () => {
		const res = await speechAn(makeCtx({
			param: '2026-demo.an',
			path: '/api/an/2026-demo.an',
			resolver: () => ({ success: true, results: [] })
		}));
		expect(res.status).toBe(404);
	});

	it('resolves via path fallback when pathParam is missing and path is valid', async () => {
		const res = await speechAn(makeCtx({
			param: undefined,
			path: '/api/an/2026-demo.an',
			resolver: () => ({ success: true, results: [] })
		}));
		expect(res.status).toBe(404);
	});

	it('returns 404 when path fallback contains a malformed URI escape', async () => {
		const res = await speechAn(makeCtx({
			param: undefined,
			path: '/api/an/%E0%A4%A.an',
			resolver: () => ({ success: true, results: [] })
		}));
		expect(res.status).toBe(404);
	});
});

describe('serveAnByKey numeric head path Content-Length', () => {
	it('sets Content-Length on HEAD for numeric section', async () => {
		const res = await serveAnByKey(makeCtx({
			method: 'HEAD',
			resolver: (sql, args) => {
				if (sql.includes('FROM sections WHERE section_id = ?') && args[0] === 42) {
					return {
						success: true,
						results: [{ section_speaker: 'a', section_content: 'Plain', display_name: 'Demo', name: 'A' }]
					};
				}
				return { success: true, results: [] };
			}
		}), '42.an');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Length')).not.toBeNull();
	});
});

describe('speaker_detail direct invocation', () => {
	it('returns 400 when the route param is truly empty', async () => {
		const res = await speakerDetail({
			req: {
				url: 'https://example.com/api/speaker_detail/',
				path: '/api/speaker_detail/',
				header: () => null,
				param: () => '',
				query: () => null
			},
			env: {
				DB: {
					prepare: () => ({ bind: () => ({ first: async () => null }), first: async () => null })
				}
			},
			json: (body: any, status = 200, headers: Record<string, string> = {}) =>
				new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
		} as unknown as Context<ApiEnv>);
		expect(res.status).toBe(400);
	});
});

describe('speechIndex direct invocation with null/array nest inputs', () => {
	it('handles a null nest_filenames column via the null/undefined early return', async () => {
		const ctx = makeCtx({
			resolver: (sql) => {
				if (sql.includes('FROM speech_index ORDER BY id ASC')) {
					return {
						success: true,
						results: [
							{ filename: 'a', display_name: 'A', isNested: 0, nest_filenames: null, nest_display_names: undefined }
						]
					};
				}
				return { success: true, results: [] };
			}
		});
		const res = await speechIndex(ctx);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any[];
		expect(body[0].nest_filenames).toEqual([]);
	});

	it('preserves array-typed nest_filenames straight through', async () => {
		const ctx = makeCtx({
			resolver: (sql) => {
				if (sql.includes('FROM speech_index ORDER BY id ASC')) {
					return {
						success: true,
						results: [
							{ filename: 'b', display_name: 'B', isNested: 1, nest_filenames: ['n1', 'n2'], nest_display_names: ['D1', 'D2'] }
						]
					};
				}
				return { success: true, results: [] };
			}
		});
		const res = await speechIndex(ctx);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any[];
		expect(body[0].nest_filenames).toEqual(['n1', 'n2']);
	});
});

describe('docsFromMarkdown fallback push', () => {
	it('pushes a fallback block when no speaker heading matches', async () => {
		// `# T\n## A:` — speaker heading consumes A: leaving no content. First block flush
		// pushes nothing (empty content). Then fallback path activates on line 192.
		const docs = docsFromMarkdown('# T\n## A:', '/t', 't');
		expect(docs).toHaveLength(1);
		expect(docs[0].title).toBe('T');
	});
});

describe('reorderSections prev-in-set skip branch', () => {
	const mk = (id: number, prev: number | null, next: number | null): SectionLike => ({
		section_id: id,
		previous_section_id: prev,
		next_section_id: next
	});

	it('skips head search when a later section has prev already in set', () => {
		// Two null-prev sections; second iteration sees minId already set with lower id, so branch
		// `s.section_id < minId` is false and skips.
		const a = mk(1, null, 2);
		const b = mk(5, null, 6);
		const result = reorderSections([a, b]);
		expect(result[0].section_id).toBe(1);
	});
});

describe('og_routes parseContent JSON-string branch', () => {
	it('unwraps JSON-encoded string section_content', async () => {
		const generator = async () => new Uint8Array([1]);
		const loader: OgLoader = async () => ({
			generateQuoteOgImage: async (quote: string) => {
				// Quote is the parseContent-unwrapped value, not the raw JSON.
				expect(quote).toBe('direct quote');
				return generator();
			},
			generateOgImage: generator
		});
		const ctx = makeCtx({
			url: 'https://example.com/og/speech/42.png',
			param: '42.png',
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return {
						success: true,
						results: [{
							filename: '2026-demo',
							section_speaker: 'a',
							section_content: '"direct quote"',
							display_name: 'Demo',
							photoURL: null,
							name: 'A'
						}]
					};
				}
				return { success: true, results: [] };
			}
		});
		const res = await handleOgSpeechImage(ctx, loader);
		expect(res.status).toBe(200);
	});
});
