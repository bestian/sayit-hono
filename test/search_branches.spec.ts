import { describe, expect, it } from 'vite-plus/test';
import { createMockEnv, dispatch, type QueryResolver } from './helpers/mockEnv';

describe('/api/search.json — speaker filter branches', () => {
	const resolver: QueryResolver = (sql, args) => {
		if (sql.includes('SELECT id, route_pathname, name FROM speakers WHERE id = ?')) {
			if (args[0] === 42) {
				return { success: true, results: [{ id: 42, route_pathname: 'audrey-tang', name: 'Audrey Tang' }] };
			}
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
			return { success: true, results: [{ count: 1 }] };
		}
		if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
			return {
				success: true,
				results: [
					{
						filename: '2026-demo',
						nest_filename: 'child',
						display_name: '2026-demo Demo',
						section_id: 42,
						section_speaker: 'audrey-tang',
						section_content: '<p>a needle here</p>',
						speaker_name: 'Audrey Tang',
						photoURL: null,
					},
				],
			};
		}
		return { success: true, results: [] };
	};

	it('filters sections by speaker route_pathname when p= is provided', async () => {
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/search.json?q=needle&p=42', env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { results: Array<{ url: string }> };
		expect(body.results[0].url).toBe('/2026-demo/child#s42');
	});

	it('ignores unknown p= value (no speaker filter, runs normal search)', async () => {
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/search.json?q=needle&p=999', env);
		expect(res.status).toBe(200);
	});

	it('returns empty results when q is too short', async () => {
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/search.json?q=x', env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { results: unknown[] };
		expect(body.results).toEqual([]);
	});

	it('caps limit to max size when over', async () => {
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/search.json?q=needle&limit=9999', env);
		expect(res.status).toBe(200);
	});

	it('defaults limit when value is non-numeric', async () => {
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/search.json?q=needle&limit=xyz', env);
		expect(res.status).toBe(200);
	});
});

describe('/search/ — speaker filter branches', () => {
	const resolver: QueryResolver = (sql, args) => {
		if (sql.includes('SELECT id, route_pathname, name FROM speakers WHERE id = ?')) {
			if (args[0] === 42) {
				return { success: true, results: [{ id: 42, route_pathname: 'audrey-tang', name: 'Audrey Tang' }] };
			}
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
			return { success: true, results: [{ count: 3 }] };
		}
		if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
			return {
				success: true,
				results: [
					{
						filename: '2026-demo',
						nest_filename: null,
						display_name: '2026-demo Demo',
						section_id: 42,
						section_speaker: 'audrey-tang',
						section_content: '<p>needle match</p>',
						speaker_name: 'Audrey Tang',
						photoURL: null,
					},
				],
			};
		}
		return { success: true, results: [] };
	};

	it('returns 500 when the runSearchQuery throws', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
				throw new Error('db down');
			}
			return resolver(sql, args);
		});
		const { res } = await dispatch('/search/?q=needle', env);
		expect(res.status).toBe(500);
	});

	it('falls back to page 1 when page parameter is invalid', async () => {
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/search/?q=needle&page=-5', env);
		expect(res.status).toBe(200);
	});

	it('handles a valid speaker filter with pagination', async () => {
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/search/?q=needle&p=42&page=2', env);
		expect(res.status).toBe(200);
	});
});
