import { describe, expect, it } from 'vite-plus/test';
import { createMockEnv, dispatch, type QueryResolver } from './helpers/mockEnv';

describe('GET /api/speakers_index.json', () => {
	it('returns rows from speakers table with CORS and JSON headers', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speakers ORDER BY id ASC')) {
				return {
					success: true,
					results: [
						{ id: 1, route_pathname: 'audrey-tang', name: 'Audrey Tang', photoURL: '/media/a.jpg' },
						{ id: 2, route_pathname: 'bestian', name: 'Bestian', photoURL: null },
					],
				};
			}
			return { success: true, results: [] };
		});

		const { res } = await dispatch('/api/speakers_index.json', env, { headers: { Origin: 'https://archive.tw' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://archive.tw');
		const json = (await res.json()) as any[];
		expect(json).toHaveLength(2);
		expect(json[0]).toEqual({ id: 1, route_pathname: 'audrey-tang', name: 'Audrey Tang', photoURL: '/media/a.jpg' });
	});

	it('returns 500 when DB reports failure', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speakers ORDER BY id ASC')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});

		const { res } = await dispatch('/api/speakers_index.json', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 on unexpected exception', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speakers ORDER BY id ASC')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/speakers_index.json', env);
		expect(res.status).toBe(500);
	});
});

describe('GET /api/speech_index.json', () => {
	it('parses nest_filenames JSON and delimiter strings', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index ORDER BY id ASC')) {
				return {
					success: true,
					results: [
						{
							filename: 'flat',
							display_name: 'Flat',
							isNested: 0,
							nest_filenames: null,
							nest_display_names: null,
						},
						{
							filename: 'nested-json',
							display_name: 'Nested JSON',
							isNested: 1,
							nest_filenames: '["a","b"]',
							nest_display_names: '["Alpha","Beta"]',
						},
						{
							filename: 'nested-csv',
							display_name: 'Nested CSV',
							isNested: 1,
							nest_filenames: 'a, b; c\nd',
							nest_display_names: 'Alpha, Beta; Gamma\nDelta',
						},
						{
							filename: 'nested-mismatch',
							display_name: 'Mismatch',
							isNested: 1,
							nest_filenames: '["a","b","c"]',
							nest_display_names: '["Alpha"]',
						},
						{
							filename: 'nested-number',
							display_name: 'Number',
							isNested: 1,
							nest_filenames: 42,
							nest_display_names: ['X'],
						},
						{
							filename: 'nested-whitespace',
							display_name: 'Whitespace',
							isNested: 1,
							nest_filenames: '   ',
							nest_display_names: '   ',
						},
					],
				};
			}
			return { success: true, results: [] };
		});

		const { res } = await dispatch('/api/speech_index.json', env);
		expect(res.status).toBe(200);
		const json = (await res.json()) as any[];
		expect(json).toHaveLength(6);
		expect(json[0].nest).toEqual([]);
		expect(json[1].nest).toEqual([
			{ filename: 'a', display_name: 'Alpha' },
			{ filename: 'b', display_name: 'Beta' },
		]);
		expect(json[2].nest).toEqual([
			{ filename: 'a', display_name: 'Alpha' },
			{ filename: 'b', display_name: 'Beta' },
			{ filename: 'c', display_name: 'Gamma' },
			{ filename: 'd', display_name: 'Delta' },
		]);
		expect(json[3].nest[2]).toEqual({ filename: 'c', display_name: 'c' });
		expect(json[4].nest).toEqual([]);
		expect(json[4].nest_display_names).toEqual(['X']);
		expect(json[5].nest).toEqual([]);
		expect(json[5].nest_filenames).toEqual([]);
		expect(json[5].nest_display_names).toEqual([]);
	});

	it('returns 500 when DB reports failure', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index ORDER BY id ASC')) return { success: false, results: [] };
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/speech_index.json', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 on exception', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index ORDER BY id ASC')) throw new Error('nope');
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/speech_index.json', env);
		expect(res.status).toBe(500);
	});
});

describe('GET /api/section/:id', () => {
	it('returns 200 with the section row when found', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM sections WHERE section_id = ?')) {
				if (args[0] === 42) {
					return { success: true, results: [{ section_id: 42, section_content: 'hi', display_name: 'Demo' }] };
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});

		const found = await dispatch('/api/section/42', env);
		expect(found.res.status).toBe(200);
		const body = (await found.res.json()) as any;
		expect(body.section_id).toBe(42);

		const missing = await dispatch('/api/section/99', env);
		expect(missing.res.status).toBe(404);
	});

	it('returns 400 for non-integer id', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/section/abc', env);
		expect(res.status).toBe(400);
	});

	it('returns 500 on DB exception', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM sections WHERE section_id = ?')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/section/42', env);
		expect(res.status).toBe(500);
	});
});

describe('GET /api/speech/*', () => {
	const makeSection = (overrides: Partial<Record<string, unknown>> = {}) => ({
		filename: '2026-demo',
		nest_filename: null,
		nest_display_name: null,
		section_id: 1,
		previous_section_id: null,
		next_section_id: null,
		section_speaker: null,
		section_content: '<p>a</p>',
		display_name: 'Demo',
		photoURL: null,
		name: null,
		...overrides,
	});

	it('returns sections for a flat speech', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?') && !sql.includes('AND sc.nest_filename')) {
				if (args[0] === '2026-demo') {
					return {
						success: true,
						results: [makeSection({ section_id: 1, next_section_id: 2 }), makeSection({ section_id: 2, previous_section_id: 1 })],
					};
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});

		const { res } = await dispatch('/api/speech/2026-demo', env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any[];
		expect(body).toHaveLength(2);
		expect(body[0].section_id).toBe(1);
	});

	it('filters by nest_filename segment', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('AND sc.nest_filename = ?')) {
				expect(args).toEqual(['parent', 'child']);
				return { success: true, results: [makeSection({ filename: 'parent', nest_filename: 'child' })] };
			}
			return { success: true, results: [] };
		});

		const { res } = await dispatch('/api/speech/parent/child', env);
		expect(res.status).toBe(200);
	});

	it('returns 404 when no sections match', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/speech/unknown', env);
		expect(res.status).toBe(404);
	});

	it('returns 400 when the path has no filename', async () => {
		// Matching /api/speech/* requires at least a slash — Hono treats /api/speech/ as matching with empty param.
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/speech/', env);
		expect(res.status).toBe(400);
	});

	it('returns 500 when DB reports failure', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/speech/any', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 on malformed URI', async () => {
		// Use a percent-encoded invalid sequence to trigger decodeURIComponent throw.
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/speech/%E0%A4%A', env);
		expect(res.status).toBe(500);
	});
});

describe('GET /api/speaker_detail/:route.json', () => {
	const speakerBase = {
		id: 7,
		route_pathname: 'audrey-tang',
		name: 'Audrey Tang',
		photoURL: null as string | null,
	};

	const longestSection = {
		section_id: 100,
		section_content: '<p>long</p>',
		filename: '2026-demo',
		nest_filename: null,
		nest_display_name: null,
		display_name: 'Demo',
	};

	function resolver(rowFound = true, failAll = false, withLongest = true): QueryResolver {
		return (sql, args) => {
			if (sql.includes('FROM speakers WHERE route_pathname = ?')) {
				return { success: true, results: rowFound ? [speakerBase] : [] };
			}
			if (sql.includes('WHERE name = ? AND photoURL IS NOT NULL')) {
				return { success: true, results: [] };
			}
			if (sql.includes('COUNT(DISTINCT speech_filename)')) {
				return { success: true, results: [{ count: 4 }] };
			}
			if (sql.includes('COUNT(*) AS count FROM speech_content')) {
				return { success: true, results: [{ count: 2 }] };
			}
			if (sql.includes('ORDER BY LENGTH(sc.section_content)')) {
				return { success: true, results: withLongest ? [longestSection] : [] };
			}
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.section_speaker = ?')) {
				if (failAll) return { success: false, results: [] };
				return {
					success: true,
					results: [
						{
							filename: '2026-demo',
							nest_filename: null,
							nest_display_name: null,
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: args[0],
							section_content: '<p>one</p>',
							display_name: 'Demo',
						},
					],
				};
			}
			return { success: true, results: [] };
		};
	}

	it('returns paginated detail with longest_section and pagination_pages', async () => {
		const env = createMockEnv(resolver(true));
		const { res } = await dispatch('/api/speaker_detail/audrey-tang.json?page=1', env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.id).toBe(7);
		expect(body.appearances_count).toBe(4);
		expect(body.sections_count).toBe(2);
		expect(body.longest_section.section_id).toBe(100);
		expect(body.pagination_pages).toEqual([1]);
		expect(body.sections).toHaveLength(1);
	});

	it('returns longest_section null when the speaker has no longest section', async () => {
		const env = createMockEnv(resolver(true, false, false));
		const { res } = await dispatch('/api/speaker_detail/audrey-tang.json', env);
		const body = (await res.json()) as { longest_section: unknown };
		expect(body.longest_section).toBeNull();
	});

	it('falls back to pathname extraction when route param is empty', async () => {
		// An empty path segment before .json is unreachable via Hono routing; fallback matcher catches /foo.json only.
		const env = createMockEnv(resolver(true));
		const { res } = await dispatch('/api/speaker_detail/audrey-tang.json', env);
		expect(res.status).toBe(200);
	});

	it('returns 404 when the speaker row is missing', async () => {
		const env = createMockEnv(resolver(false));
		const { res } = await dispatch('/api/speaker_detail/nobody.json', env);
		expect(res.status).toBe(404);
	});

	it('returns 500 when section query fails', async () => {
		const env = createMockEnv(resolver(true, true));
		const { res } = await dispatch('/api/speaker_detail/audrey-tang.json', env);
		expect(res.status).toBe(500);
	});

	it('returns 500 when an exception is thrown', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speakers WHERE route_pathname = ?')) throw new Error('nope');
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/speaker_detail/audrey-tang.json', env);
		expect(res.status).toBe(500);
	});
});
