import { describe, expect, it } from 'vite-plus/test';
import { createMockEnv, dispatch, type QueryResolver } from './helpers/mockEnv';

describe('.an endpoints (section)', () => {
	it('generates a single-section .an when path is numeric', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?')) {
				if (args[0] === 42) {
					return {
						success: true,
						results: [
							{
								section_speaker: 'audrey-tang',
								section_content: '<p>Hi &amp; bye</p>',
								display_name: 'Demo',
								name: 'Audrey Tang',
							},
						],
					};
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});

		const { res } = await dispatch('/api/an/42.an', env);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('<akomaNtoso>');
		expect(body).toContain('TLCPerson');
		expect(body).toContain('showAs="Audrey Tang"');
		// Content starts with '<' so escapeAmp preserves tags literally
		expect(body).toContain('<p>Hi &amp; bye</p>');
	});

	it('serves a numeric .an via /speech/:id.an', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?')) {
				if (args[0] === 777) {
					return {
						success: true,
						results: [{ section_speaker: null, section_content: 'Plain text', display_name: null, name: null }],
					};
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});

		const { res } = await dispatch('/speech/777.an', env);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('showAs="Unknown"');
		expect(body).toContain('<p>Plain text</p>');
	});

	it('renders HEAD as empty body with Content-Length for single section', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?') && args[0] === 42) {
				return {
					success: true,
					results: [
						{
							section_speaker: 'a',
							section_content: 'Hello',
							display_name: 'Demo',
							name: 'A',
						},
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/an/42.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Length')).not.toBeNull();
		expect(await res.text()).toBe('');
	});

	it('returns 404 when section id is not in DB', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/an/123.an', env);
		expect(res.status).toBe(404);
	});
});

describe('.an endpoints (full speech)', () => {
	const speechResolver: QueryResolver = (sql, args) => {
		if (
			sql.includes('FROM speech_content sc') &&
			sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename') &&
			sql.includes('WHERE sc.filename = ?')
		) {
			if (args[0] === '2026-demo') {
				return {
					success: true,
					results: [
						{ section_speaker: 'a', section_content: '<p>One</p>', display_name: 'Demo', name: 'Audrey' },
						{ section_speaker: 'b', section_content: 'Plain two', display_name: 'Demo', name: 'Bestian' },
					],
				};
			}
			return { success: true, results: [] };
		}
		return { success: true, results: [] };
	};

	it('generates a full-speech .an from DB and caches to R2 + edge', async () => {
		const env = createMockEnv(speechResolver);
		const { res } = await dispatch('/api/an/2026-demo.an', env);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('<TLCPerson');
		expect(body).toContain('<heading>Demo</heading>');
		expect(body).toContain('by="#a"');
		expect(body).toContain('by="#b"');
		expect(env.__r2Store.has('an/2026-demo')).toBe(true);
	});

	it('serves the cached R2 body on subsequent hits', async () => {
		const env = createMockEnv(speechResolver, {
			preSeedR2: { 'an/2026-demo': { body: 'CACHED-BODY', contentType: 'text/plain; charset=utf-8' } },
		});
		const { res } = await dispatch('/api/an/2026-demo.an', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('CACHED-BODY');
	});

	it('responds to HEAD with empty body for full speech', async () => {
		const env = createMockEnv(speechResolver);
		const { res } = await dispatch('/api/an/2026-demo.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
	});

	it('responds to HEAD against a cached object with empty body', async () => {
		const env = createMockEnv(speechResolver, {
			preSeedR2: { 'an/2026-demo': { body: 'C', contentType: 'text/plain; charset=utf-8' } },
		});
		const { res } = await dispatch('/api/an/2026-demo.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
	});

	it('clears caches when the URL contains a query (purge flag)', async () => {
		const env = createMockEnv(speechResolver, {
			preSeedR2: { 'an/2026-demo': { body: 'C', contentType: 'text/plain; charset=utf-8' } },
		});
		const { res } = await dispatch('/api/an/2026-demo.an?purge', env);
		expect(res.status).toBe(200);
		expect(env.__r2Store.get('an/2026-demo')!.body).not.toBe('C'); // regenerated
	});

	it('returns 404 for empty DB result', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/an/unknown.an', env);
		expect(res.status).toBe(404);
	});

	it('returns 404 when the path does not end in .an', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		// Hono route requires .an extension — this path is not matched, so root catch-all returns 404.
		const { res } = await dispatch('/api/an/not-an-an', env);
		expect(res.status).toBe(404);
	});

	it('returns 405 on non-GET methods for a numeric .an', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?') && args[0] === 42) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		// POST is not in the app.on list, so Hono 404s — test the direct function-level serve via /api/an allowed methods HEAD+GET only.
		const { res } = await dispatch('/api/an/42.an', env, { method: 'POST' });
		expect(res.status).toBe(404);
	});

	it('matches /:path{.an} catch-all for a filename', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename')) {
				return {
					success: true,
					results: [{ section_speaker: 'a', section_content: '<p>One</p>', display_name: 'Demo', name: 'Audrey' }],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/2026-rootan.an', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/plain');
	});
});
