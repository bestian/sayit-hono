import { describe, expect, it } from 'vite-plus/test';
import { __test__, serveMdByKey } from '../src/api/md';
import type { Context } from 'hono';
import type { ApiEnv } from '../src/api/types';
import { createMockEnv, dispatch, type QueryResolver } from './helpers/mockEnv';

describe('md/an2md (unit)', () => {
	it('preserves <svg>, <br>, <img>, <a>, <iframe> blocks through conversion', () => {
		const svgBlock = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>';
		const anXml = `<?xml version="1.0"?><akomaNtoso>
			<heading>With Media ${svgBlock}</heading>
			<TLCPerson id="p1" showAs="Audrey"/>
			<speech by="#p1">
				<p>Line one<br>Line two</p>
				<p><img src="/a.png" alt="pic"></p>
				<p><a href="/x">link</a></p>
				<p><iframe src="/embed"></iframe></p>
				${svgBlock}
			</speech>
		</akomaNtoso>`;
		const md = __test__.an2md(anXml);
		expect(md).toContain('With Media');
		expect(md).toContain(svgBlock);
		// <br> is in PRESERVE_VOID_TAGS so it's kept literally, not converted to \n
		expect(md).toContain('Line one<br>Line two');
		expect(md).toContain('<img src="/a.png"');
		expect(md).toContain('<a href="/x">link</a>');
		expect(md).toContain('<iframe src="/embed"></iframe>');
	});

	it('merges consecutive blocks from the same speaker under one heading', () => {
		const anXml = `<?xml version="1.0"?><akomaNtoso>
			<heading>Multi</heading>
			<TLCPerson id="p1" showAs="Audrey"/>
			<speech by="#p1"><p>First</p></speech>
			<speech by="#p1"><p>Second</p></speech>
			<TLCPerson id="p2" showAs="Bestian"/>
			<speech by="#p2"><p>Third</p></speech>
		</akomaNtoso>`;
		const md = __test__.an2md(anXml);
		const firstHeadingCount = (md.match(/### Audrey:/g) ?? []).length;
		expect(firstHeadingCount).toBe(1);
		expect(md).toContain('### Bestian');
		expect(md).toContain('First');
		expect(md).toContain('Second');
		expect(md).toContain('Third');
	});

	it('falls back to unknown speaker id when TLCPerson missing', () => {
		const anXml = '<akomaNtoso><speech by="#ghost"><p>Hi</p></speech></akomaNtoso>';
		expect(__test__.an2md(anXml)).toContain('### ghost');
	});

	it('returns empty heading when no <heading> element', () => {
		expect(__test__.an2md('<akomaNtoso><speech by="#p"><p>x</p></speech></akomaNtoso>')).not.toMatch(/^#\s/m);
	});

	it('preserves plain-text speech content without <p> wrapper', () => {
		const md = __test__.an2md('<akomaNtoso><TLCPerson id="p" showAs="A"/><speech by="#p">Hello world</speech></akomaNtoso>');
		expect(md).toContain('Hello world');
	});
});

describe('/api/md/* and /speech/:id.md', () => {
	const sectionResolver: QueryResolver = (sql, args) => {
		if (sql.includes('FROM sections WHERE section_id = ?')) {
			if (args[0] === 55) {
				return {
					success: true,
					results: [
						{
							section_speaker: 'audrey-tang',
							section_content: '<p>Body text</p>',
							display_name: 'Demo',
							name: 'Audrey',
						},
					],
				};
			}
			return { success: true, results: [] };
		}
		return { success: true, results: [] };
	};

	it('generates .md for a single section (no caching)', async () => {
		const env = createMockEnv(sectionResolver);
		const { res } = await dispatch('/api/md/55.md', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/markdown');
		const body = await res.text();
		expect(body).toContain('# Demo');
		expect(body).toContain('### Audrey');
		// Section-level .md must not be cached
		expect(env.__r2Store.size).toBe(0);
	});

	it('serves /speech/:id.md pass-through to md handler', async () => {
		const env = createMockEnv(sectionResolver);
		const { res } = await dispatch('/speech/55.md', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('# Demo');
	});

	it('returns 404 when the requested section is missing', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/md/999.md', env);
		expect(res.status).toBe(404);
	});

	const fullResolver: QueryResolver = (sql, args) => {
		if (
			sql.includes('FROM speech_content sc') &&
			sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename') &&
			sql.includes('WHERE sc.filename = ?')
		) {
			if (args[0] === '2026-demo') {
				return {
					success: true,
					results: [{ section_speaker: 'a', section_content: '<p>Hello.</p>', display_name: 'Demo', name: 'Audrey' }],
				};
			}
			return { success: true, results: [] };
		}
		return { success: true, results: [] };
	};

	it('caches full-speech .md in R2 and edge on generation', async () => {
		const env = createMockEnv(fullResolver);
		const { res } = await dispatch('/api/md/2026-demo.md', env);
		expect(res.status).toBe(200);
		expect(env.__r2Store.has('md/2026-demo')).toBe(true);
	});

	it('serves cached full-speech .md from R2 when pre-seeded', async () => {
		const env = createMockEnv(fullResolver, {
			preSeedR2: { 'md/2026-demo': { body: '# cached content', contentType: 'text/markdown; charset=utf-8' } },
		});
		const { res } = await dispatch('/api/md/2026-demo.md', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('cached content');
	});

	it('purges caches when ?purge is present and regenerates the body', async () => {
		const env = createMockEnv(fullResolver, {
			preSeedR2: { 'md/2026-demo': { body: 'STALE', contentType: 'text/markdown; charset=utf-8' } },
		});
		const { res } = await dispatch('/api/md/2026-demo.md?purge', env);
		expect(res.status).toBe(200);
		expect(env.__r2Store.get('md/2026-demo')!.body).not.toContain('STALE');
	});

	it('matches /:path{.md} catch-all for a filename', async () => {
		const env = createMockEnv(fullResolver);
		const { res } = await dispatch('/2026-demo.md', env);
		expect(res.status).toBe(200);
	});

	it('returns 404 for an un-mapped full-speech path', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/md/unknown.md', env);
		expect(res.status).toBe(404);
	});
});

function createServeContext(overrides: Partial<{ method: string; url: string; origin: string | null }> = {}) {
	return {
		req: {
			method: overrides.method ?? 'GET',
			url: overrides.url ?? 'https://example.com/api/md/demo.md',
			header: (k: string) => (k === 'Origin' ? (overrides.origin ?? null) : null),
		},
		env: {
			SPEECH_CACHE: {
				get: async () => null,
				put: async () => {},
				delete: async () => true,
			},
			DB: {
				prepare: () => ({
					bind: () => ({ first: async () => null, all: async () => ({ success: true, results: [] }) }),
					first: async () => null,
					all: async () => ({ success: true, results: [] }),
				}),
			},
		},
		text: (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers }),
	} as unknown as Context<ApiEnv>;
}

describe('serveMdByKey guards', () => {
	it('returns 404 for an empty object key', async () => {
		const res = await serveMdByKey(createServeContext(), '');
		expect(res.status).toBe(404);
	});

	it('returns 404 for a key without .md extension', async () => {
		const res = await serveMdByKey(createServeContext(), 'bad-key');
		expect(res.status).toBe(404);
	});
});
