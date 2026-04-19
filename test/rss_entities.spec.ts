import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function makeEnv(resolver: Resolver) {
	return {
		AUDREYT_TRANSCRIPT_TOKEN: 'x',
		BESTIAN_TRANSCRIPT_TOKEN: 'y',
		ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
		SPEECH_CACHE: {
			get: async () => null,
			put: async () => {},
			delete: async () => true,
			list: async () => ({ objects: [], truncated: false, cursor: '' })
		},
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
	};
}

async function request(path: string, env: ReturnType<typeof makeEnv>) {
	const req = new IncomingRequest(`https://example.com${path}`);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('rss decodeHtmlEntities branches', () => {
	it('decodes decimal, hex, and named entities in summary', async () => {
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return {
					success: true,
					results: [{
						id: 1,
						filename: '2026-06-10-demo',
						display_name: '2026-06-10 Demo',
						isNested: 0,
						first_nest_filename: null,
						first_nest_display_name: null,
						first_section_content: '<p>A&#39;B &amp; C&#x26;D &nbsp;E</p>',
						first_speaker_name: 'Audrey'
					}]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/rss.xml', env);
		const xml = await res.text();
		// Numeric and hex entities get decoded before XML escaping
		// Named & stays as &amp; after re-escaping
		expect(xml).toContain('Audrey: A&apos;B &amp; C&amp;D');
	});

	it('leaves oversized numeric entities untouched', async () => {
		const env = makeEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return {
					success: true,
					results: [{
						id: 1,
						filename: '2026-06-11-demo',
						display_name: '2026-06-11 Demo',
						isNested: 0,
						first_nest_filename: null,
						first_nest_display_name: null,
						first_section_content: '<p>Invalid &#99999999999999;</p>',
						first_speaker_name: null
					}]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await request('/rss.xml', env);
		const xml = await res.text();
		expect(xml).toContain('Invalid');
	});
});
