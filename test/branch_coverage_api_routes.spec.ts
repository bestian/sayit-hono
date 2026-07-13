import { describe, expect, it, vi } from 'vite-plus/test';
import { dispatch, createMockEnv } from './helpers/mockEnv';
import { __test__ as mdTest } from '../src/api/md';
import {
	buildR2HtmlKey,
	buildR2HtmlKey as htmlKey,
	purgeWorkersCache,
	readR2Cache,
	withCacheHeaders,
	speakerRequestPath,
	writeR2Cache,
} from '../src/api/cache';
import { cache } from 'cloudflare:workers';
import { handleOgSpeechImage } from '../src/api/og_routes';
import { speakerDetail } from '../src/api/speaker_detail';
import type { OgGenerators } from '../src/api/og_routes';

describe('API route branch closure', () => {
	it('covers sparse AN rows, null links, HEAD and no-origin CORS', async () => {
		const row = {
			section_id: 1,
			previous_section_id: null,
			next_section_id: null,
			section_speaker: null,
			section_content: null,
			display_name: null,
			name: null,
		};
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_content')) return { success: true, results: [row] };
			if (sql.includes('FROM sections')) return { success: true, results: [{ filename: 'demo', ...row }] };
			return { success: true, results: [] };
		});
		const full = await dispatch('/api/an/demo.an', env);
		expect(full.res.status).toBe(200);
		expect(await full.res.text()).toContain('unknown');
		const head = await dispatch('/api/an/demo.an', env, { method: 'HEAD' });
		expect(head.res.status).toBe(200);
		expect(head.res.headers.get('Content-Length')).toBeTruthy();
		const missing = await dispatch(
			'/api/an/7.an',
			createMockEnv(() => ({ success: true, results: [] })),
		);
		expect(missing.res.status).toBe(404);
	});

	it('covers malformed and empty markdown conversion paths', () => {
		expect(
			mdTest.an2md(
				'<akomaNtoso><debateBody><debateSection><speech by="#x"><p></p><!--x--></speech></debateSection></debateBody></akomaNtoso>',
			),
		).toBe('');
		expect(mdTest.an2md('<heading><svg><path/></svg></heading><speech by="#x"><p>hi</p></speech>')).toContain('<svg>');
		expect(mdTest.an2md('<speech by="#x"><p><a href="/x">link</a></p><p><br/></p></speech>')).toContain('<a');
	});

	it('covers markdown missing object and origin-free response', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const bad = await dispatch('/api/md/not-markdown.txt', env);
		expect(bad.res.status).toBe(404);
		const empty = await dispatch('/api/md/55.md', env);
		expect(empty.res.status).toBe(404);
	});

	it('covers cache defaults, absent metadata and header branches', async () => {
		const bucket = {
			get: async () => ({ body: 'x', size: 0, httpMetadata: {}, customMetadata: {}, httpEtag: null, text: async () => 'x' }),
			put: async () => undefined,
			delete: async () => undefined,
		};
		const cached = await readR2Cache(bucket, 'k');
		expect(cached?.headers.get('Content-Type')).toContain('text/html');
		expect(cached?.headers.get('Content-Length')).toBe('0');
		expect(withCacheHeaders(new Response('x')).headers.get('Cache-Tag')).toBeNull();
		expect(buildR2HtmlKey('https://archive.tw/a?x=1', { includeSearch: false })).not.toContain('?x=1');
		expect(htmlKey('https://archive.tw/a')).toContain('/a');
	});

	it('covers purge explicit failure and thrown failure', async () => {
		const purge = vi.spyOn(cache, 'purge');
		purge.mockResolvedValue({ success: false, errors: [] });
		expect(await purgeWorkersCache({ tags: ['x'] })).toBe(false);
		purge.mockRejectedValue(new Error('failure'));
		expect(await purgeWorkersCache({ purgeEverything: true })).toBe(false);
		purge.mockRestore();
	});

	it('covers RSS long unbroken summary and DB failure', async () => {
		const row = {
			id: 1,
			filename: 'bad-date',
			display_name: 'Title',
			isNested: 0,
			first_nest_filename: null,
			first_nest_display_name: null,
			first_section_content: 'x'.repeat(400),
			first_speaker_name: null,
		};
		const ok = await dispatch(
			'/rss.xml',
			createMockEnv((sql) => (sql.includes('speech_index') ? { success: true, results: [row] } : { success: true, results: [] })),
		);
		expect(ok.res.status).toBe(200);
		expect(await ok.res.text()).toContain('...');
		const fail = await dispatch(
			'/rss.xml',
			createMockEnv(() => ({ success: false, results: [] })),
		);
		expect(fail.res.status).toBe(500);
	});

	it('covers speaker invalid counts, sparse rows and query errors', async () => {
		const resolver = (sql: string) => {
			if (sql.includes('FROM speakers WHERE route_pathname = ?'))
				return { success: true, results: [{ id: 1, route_pathname: 'x', name: 'X', photoURL: null }] };
			if (sql.includes('WHERE name = ? AND photoURL IS NOT NULL')) return { success: true, results: [] };
			if (sql.includes('COUNT(DISTINCT speech_filename)')) return { success: true, results: [{ count: 'nope' }] };
			if (sql.includes('COUNT(*) AS count FROM speech_content')) return { success: true, results: [{ count: '-1' }] };
			if (sql.includes('ORDER BY LENGTH(sc.section_content)')) return { success: true, results: [] };
			return {
				success: true,
				results: [{ filename: 'f', section_id: 1, section_speaker: 'x', section_content: null, display_name: null }],
			};
		};
		const res = await dispatch('/api/speaker_detail/x.json?page=wat', createMockEnv(resolver));
		expect(res.res.status).toBe(200);
		const body = (await res.res.json()) as { appearances_count: number; sections_count: number; longest_section: unknown };
		expect(body.appearances_count).toBe(0);
		// helper clamps non-finite / negative COUNT results to 0 before the API layer
		expect(body.sections_count).toBe(0);
		expect(body.longest_section).toBeNull();
		const err = await dispatch(
			'/api/speaker_detail/x.json',
			createMockEnv((sql) => {
				if (sql.includes('FROM speakers WHERE route_pathname = ?')) throw new Error('db');
				return { success: true, results: [] };
			}),
		);
		expect(err.res.status).toBe(500);
	});

	it('covers non-array parsed speech index values', async () => {
		const env = createMockEnv((sql) =>
			sql.includes('speech_index')
				? { success: true, results: [{ filename: 'f', display_name: 'F', isNested: 0, nest_filenames: '{"x":1}', nest_display_names: '' }] }
				: { success: true, results: [] },
		);
		const res = await dispatch('/api/speech_index.json', env);
		expect(res.res.status).toBe(200);
		const body = (await res.res.json()) as Array<{ nest: unknown[]; nest_filenames: string[] }>;
		expect(body[0]?.nest_filenames).toEqual(['{"x":1}']);
		expect(body[0]?.nest).toEqual([{ filename: '{"x":1}', display_name: '{"x":1}' }]);
	});
	it('covers remaining null and fallback branches', async () => {
		const fullRows = [
			{
				section_id: 1,
				previous_section_id: null,
				next_section_id: 2,
				section_speaker: 's',
				section_content: 'x',
				display_name: 'D',
				name: 'N',
			},
			{
				section_id: 2,
				previous_section_id: 1,
				next_section_id: null,
				section_speaker: 's',
				section_content: 'y',
				display_name: 'D',
				name: 'N',
			},
		];
		const md = await dispatch(
			'/api/md/full.md',
			createMockEnv((sql) => (sql.includes('speech_content') ? { success: true, results: fullRows } : { success: true, results: [] })),
		);
		expect(md.res.status).toBe(200);
		const invalidSpeaker = await dispatch(
			'/api/speaker_detail/.json',
			createMockEnv(() => ({ success: true, results: [] })),
		);
		expect(invalidSpeaker.res.status).toBe(400);
		const sparseSpeaker = await dispatch(
			'/api/speaker_detail/x.json',
			createMockEnv((sql) => {
				if (sql.includes('FROM speakers WHERE route_pathname = ?'))
					return {
						success: true,
						results: [
							{
								id: 1,
								route_pathname: 'x',
								name: 'X',
								photoURL: null,
							},
						],
					};
				if (sql.includes('WHERE name = ? AND photoURL IS NOT NULL')) return { success: true, results: [] };
				if (sql.includes('COUNT')) return { success: true, results: [] };
				if (sql.includes('ORDER BY LENGTH(sc.section_content)'))
					return {
						success: true,
						results: [
							{
								section_id: 2,
								section_content: null,
								filename: null,
								nest_filename: null,
								nest_display_name: null,
								display_name: null,
							},
						],
					};
				return { success: true, results: [] };
			}),
		);
		expect(sparseSpeaker.res.status).toBe(200);
		const speech = await dispatch(
			'/api/speech_index.json',
			createMockEnv(() => ({
				success: true,
				results: [{ filename: 'f', display_name: 'F', isNested: 0, nest_filenames: null, nest_display_names: null }],
			})),
		);
		expect(speech.res.status).toBe(200);
	});
	it('covers OG metadata fallbacks, missing content type avatar, and speaker query errors', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_content a'))
				return {
					success: true,
					results: [
						{
							filename: null,
							section_speaker: null,
							section_content: null,
							display_name: null,
							photoURL: '/x',
							name: null,
						},
					],
				};
			if (sql.includes('FROM speech_index WHERE')) return { success: true, results: [{ filename: 'f', display_name: 'F', isNested: 0 }] };
			if (sql.includes('SELECT sp.name')) throw new Error('speaker query');
			return { success: true, results: [] };
		});
		env.ASSETS.fetch = () => new Response(new Uint8Array([4]), { status: 200 });
		const section = await dispatch('/og/speech/1.png', env);
		expect(section.res.status).toBe(500);
		const speech = await dispatch('/og/f.png', env);
		expect(speech.res.status).toBe(200);
		const absent = await dispatch('/og/.png', env);
		expect(absent.res.status).toBe(404);
	});

	it('covers direct helper calls and rare fallback branches', async () => {
		// 1. writeR2Cache Content-Type fallback
		type PutOptions = { httpMetadata?: { cacheControl?: string; contentType?: string }; customMetadata?: Record<string, string> };
		const puts: Array<{ key: string; options?: PutOptions }> = [];
		const bucket = {
			put: async (key: string, _body: string, options?: PutOptions) => {
				puts.push({ key, options });
			},
		};
		const res = new Response('test');
		res.headers.delete('Content-Type');
		await writeR2Cache(bucket, 'test-key', res, 'custom/type');
		expect(puts[0]?.options?.httpMetadata?.contentType).toBe('custom/type');

		// 2. speakerRequestPath branches
		expect(speakerRequestPath('/audrey')).toBe('/speaker/audrey');
		expect(speakerRequestPath('audrey')).toBe('/speaker/audrey');

		// 3. handleOgSpeechImage missing param
		const mockCtxOg = {
			req: {
				param: () => undefined,
				url: 'https://example.com/og/speech/.png',
				method: 'GET',
				header: () => null,
			},
			env: {
				SPEECH_CACHE: {
					get: async () => null,
					put: async () => undefined,
				},
				DB: {
					prepare: () => ({
						bind: () => ({
							first: async () => null,
						}),
					}),
				},
				// Never reached — the missing `param` short-circuits to 404 before ASSETS
				// is touched (encodeAvatar is only called once a section is found).
				ASSETS: { fetch: async () => new Response() },
			},
			text: (body: string, status?: number) => new Response(body, { status }),
		};
		// Missing param short-circuits before the loader is ever invoked, so a trivial
		// (never-called) real-shaped OgGenerators avoids faking an empty object.
		const stubOgGenerators: OgGenerators = {
			generateQuoteOgImage: async () => new Uint8Array(),
			generateOgImage: async () => new Uint8Array(),
		};
		const ogRes = await handleOgSpeechImage(mockCtxOg, async () => stubOgGenerators);
		expect(ogRes.status).toBe(404);

		// 4. speakerDetail missing param
		const mockCtxSpeaker = {
			req: {
				param: () => undefined,
				url: 'https://example.com/api/speaker_detail/',
				header: () => undefined,
			},
			// Never reached — the missing param short-circuits to 400 before any DB query.
			env: { DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ success: true, results: [] }) }) }) } },
			json: (body: unknown, status?: number) => new Response(JSON.stringify(body), { status }),
		};
		const speakerRes = await speakerDetail(mockCtxSpeaker);
		expect(speakerRes.status).toBe(400);

		// 5. md an2md line length 0 with Unknown speaker
		expect(mdTest.an2md('<speech by="#Unknown"><p>a\n\n\nb</p></speech>')).toContain('>\n> b');
	});

	it('covers all AN ordering links and cache helper defaults', async () => {
		const rows = [
			{
				section_id: 1,
				previous_section_id: 0,
				next_section_id: 2,
				section_speaker: 's',
				section_content: '<p>x &amp; y</p>',
				display_name: 'D',
				name: 'N',
			},
			{
				section_id: 2,
				previous_section_id: 1,
				next_section_id: null,
				section_speaker: 's',
				section_content: 'text',
				display_name: null,
				name: null,
			},
		];
		const env = createMockEnv((sql) =>
			sql.includes('FROM speech_content') ? { success: true, results: rows } : { success: true, results: [] },
		);
		const res = await dispatch('/api/an/f.an', env);
		expect(res.res.status).toBe(200);
		expect(await res.res.text()).toContain('showAs="N"');
	});

	it('covers markdown unmatched SVG and malformed speaker metadata', () => {
		expect(mdTest.an2md('<heading><svg>broken</heading>')).toContain('<svg>');
		expect(mdTest.an2md('<TLCPerson id="x"/><speech by="#x"><p>one</p></speech>')).toContain('### x');
		expect(mdTest.an2md('<speech by="#x"><p><br/></p></speech>')).toContain('<br/>');
	});
});
