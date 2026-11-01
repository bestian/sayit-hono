import { describe, expect, it } from 'vite-plus/test';
import { createMockEnv, dispatch } from './helpers/mockEnv';

const searchRow = {
	filename: '2026-example',
	nest_filename: null,
	display_name: 'Example',
	section_id: 7,
	section_speaker: null,
	section_content: '<p>needle</p>',
	speaker_name: null,
	photoURL: null,
};

describe('search request budget', () => {
	it.each([
		['/api/search.json?q=needle', 1],
		['/search/?q=needle', 2],
	] as const)('denies %s before D1 and charges %i unit(s)', async (path, units) => {
		let reads = 0;
		const env = createMockEnv(() => {
			reads++;
			return { success: true, results: [] };
		});
		let actual: [string, string, number] | undefined;
		env.SEARCH_BUDGET.getByName = (name) => ({
			admit: async (key, cost) => {
				actual = [name, key, cost];
				return { allowed: false, retryAfterSeconds: 47 };
			},
		});
		const { res } = await dispatch(path, env, { headers: { 'CF-Connecting-IP': '203.0.113.5' } });
		expect(res.status).toBe(429);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Retry-After')).toBe('47');
		expect(actual).toEqual(['sitewide', 'client:203.0.113.5', units]);
		expect(reads).toBe(0);
	});

	it('uses a shared unknown-client key and ignores forwarded claims', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const keys: string[] = [];
		env.SEARCH_BUDGET.getByName = () => ({
			admit: async (key) => {
				keys.push(key);
				return { allowed: false, retryAfterSeconds: 1 };
			},
		});
		await dispatch('/api/search.json?q=needle', env, { headers: { 'X-Forwarded-For': '192.0.2.1' } });
		await dispatch('/api/search.json?q=needle', env, { headers: { 'CF-Connecting-IP': 'invalid value' } });
		expect(keys).toEqual(['client:unknown', 'client:unknown']);
	});

	it('fails closed if the binding is absent, throws, or returns an invalid decision', async () => {
		let reads = 0;
		const env = createMockEnv(() => {
			reads++;
			return { success: true, results: [] };
		});
		Object.defineProperty(env, 'SEARCH_BUDGET', { configurable: true, value: undefined });
		let res = (await dispatch('/api/search.json?q=needle', env)).res;
		expect(res.status).toBe(503);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		Object.defineProperty(env, 'SEARCH_BUDGET', {
			configurable: true,
			value: {
				getByName: () => ({
					admit: async () => {
						throw new Error('unavailable');
					},
				}),
			},
		});
		res = (await dispatch('/search/?q=needle', env)).res;
		expect(res.status).toBe(503);
		Object.defineProperty(env, 'SEARCH_BUDGET', {
			configurable: true,
			value: { getByName: () => ({ admit: async () => ({ allowed: false, retryAfterSeconds: 0 }) }) },
		});
		res = (await dispatch('/search/?q=needle', env)).res;
		expect(res.status).toBe(503);
		expect(reads).toBe(0);
	});

	it('skips the budget only when the query cannot touch D1', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		env.SEARCH_BUDGET.getByName = () => ({
			admit: async () => {
				throw new Error('unexpected budget call');
			},
		});
		expect((await dispatch('/api/search.json?q=x', env)).res.status).toBe(200);
		expect((await dispatch('/search/?q=x', env)).res.status).toBe(200);
	});

	it.each(['/api/search.json?q=x&p=42', '/search/?q=x&p=42'])('checks %s before the speaker lookup', async (path) => {
		let reads = 0;
		const env = createMockEnv(() => {
			reads++;
			return { success: true, results: [] };
		});
		env.SEARCH_BUDGET.getByName = () => ({ admit: async () => ({ allowed: false, retryAfterSeconds: 60 }) });
		const { res } = await dispatch(path, env);
		expect(res.status).toBe(429);
		expect(reads).toBe(0);
	});

	it.each(['/api/search.json?q=needle', '/search/?q=needle'])('checks HEAD %s before D1', async (path) => {
		let reads = 0;
		const env = createMockEnv(() => {
			reads++;
			return { success: true, results: [] };
		});
		env.SEARCH_BUDGET.getByName = () => ({ admit: async () => ({ allowed: false, retryAfterSeconds: 60 }) });
		const { res } = await dispatch(path, env, { method: 'HEAD' });
		expect(res.status).toBe(429);
		expect(reads).toBe(0);
	});

	it('keeps the JSON result query and HTML section count behavior', async () => {
		const queries: string[] = [];
		const env = createMockEnv((sql) => {
			queries.push(sql);
			if (sql.includes('SELECT COUNT(*) AS count')) return { success: true, results: [{ count: 1 }] };
			if (sql.includes('FROM speech_content sc') && sql.includes('ORDER BY')) return { success: true, results: [searchRow] };
			return { success: true, results: [] };
		});
		const api = (await dispatch('/api/search.json?q=needle', env)).res;
		expect(api.status).toBe(200);
		expect(((await api.json()) as { results: unknown[] }).results).toHaveLength(1);
		expect(queries.some((sql) => sql.includes('SELECT COUNT(*) AS count'))).toBe(false);
		const html = (await dispatch('/search/?q=needle', env)).res;
		expect(html.status).toBe(200);
		expect(queries.some((sql) => sql.includes('SELECT COUNT(*) AS count'))).toBe(true);
	});
});
