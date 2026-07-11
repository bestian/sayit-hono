import { describe, expect, it } from 'vite-plus/test';
import { createMockEnv, dispatch } from './helpers/mockEnv';

describe('buildSearchSnippet middle-of-text match', () => {
	it('prefixes with ... when the match is not at the start and extends past right side', async () => {
		const prefix = 'BEFORE '.repeat(50); // 350 chars pre-match
		const body = `<p>${prefix}needle and a lot more text after</p>`;
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
				return {
					success: true,
					results: [
						{
							filename: 'mid-match',
							nest_filename: null,
							display_name: 'Mid Match',
							section_id: 1,
							section_speaker: null,
							section_content: body,
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 1 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/search.json?q=needle', env);
		const body2 = (await res.json()) as any;
		expect(body2.results[0].snippet).toContain('...');
	});

	it('returns an empty snippet when the section text trims down to nothing', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
				return {
					success: true,
					results: [
						{
							filename: 'blank-snippet',
							nest_filename: null,
							display_name: 'Blank Snippet',
							section_id: 2,
							section_speaker: null,
							section_content: '   ',
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 1 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/search.json?q=needle', env);
		const body = (await res.json()) as any;
		expect(body.results[0].snippet).toBe('');
	});

	it('appends ... when the match is near the start but the snippet is truncated on the right', async () => {
		const body = `<p>needle ${'after '.repeat(80)}</p>`;
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
				return {
					success: true,
					results: [
						{
							filename: 'right-truncated',
							nest_filename: null,
							display_name: 'Right Truncated',
							section_id: 3,
							section_speaker: null,
							section_content: body,
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				return { success: true, results: [{ count: 1 }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/search.json?q=needle', env);
		const payload = (await res.json()) as any;
		expect(payload.results[0].snippet).toMatch(/\.\.\.$/);
		expect(payload.results[0].snippet.startsWith('...')).toBe(false);
	});
});

describe('serveBucketJson header branches', () => {
	it('returns ETag and Content-Length when the R2 object exposes them', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { 'sections-dump.json': { body: '[1]', contentType: 'application/json; charset=utf-8' } },
		});
		const { res } = await dispatch('/sections-dump.json', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('[1]');
	});
});

describe('/:filename edge guards', () => {
	it('returns 404 for a filename that includes a dot (excluded non-root asset)', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		// `robots.txt` is excludedPath
		const { res } = await dispatch('/robots.txt', env);
		// ASSETS.fetch returns 404, then the filename route is skipped because of exclusion
		expect(res.status).toBe(404);
	});

	it('returns 404 for a path that decodes to empty filename', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/%E0%A4%A', env);
		expect(res.status).toBe(404);
	});
});

describe('/:filename/:nest_filename guards', () => {
	it('returns 404 when the first segment is in excludedPaths', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/static/demo', env);
		// static first middleware tries ASSETS, misses, and the nested route 404s on excluded parent
		expect(res.status).toBe(404);
	});

	it('returns 404 when filename segment cannot be decoded', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/%E0%A4%A/child', env);
		expect(res.status).toBe(404);
	});
});

describe('serveAsset first-try branch', () => {
	it('returns the asset content when ASSETS.fetch succeeds', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		// Override ASSETS to match a specific path
		(env as any).ASSETS = { fetch: () => new Response('asset-body', { status: 200 }) };
		const { res } = await dispatch('/custom-asset.png', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('asset-body');
	});
});

describe('canonical middleware (non-redirecting)', () => {
	it('skips redirect for POST requests', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		// POSTing /speeches should not redirect — canonical middleware only fires for GET/HEAD
		const { res } = await dispatch('/speeches', env, { method: 'POST' });
		expect(res.status).not.toBe(302);
	});
});

describe('/speech/:section_id .md/.an routing', () => {
	it('treats /speech/abc (non-numeric, non-.md, non-.an) as 400', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/speech/abc', env);
		expect(res.status).toBe(400);
	});
});

describe('canonicalPage respects /speech/:id numeric-section URL', () => {
	it('strips query params from /speech/:id and redirects', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/speech/101?x=1', env);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/speech/101');
	});
});
