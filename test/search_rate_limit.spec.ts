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

describe('search request limits', () => {
	it.each(['/api/search.json?q=needle', '/search/?q=needle'])('denies %s before D1 when the client limit is reached', async (path) => {
		let reads = 0;
		const env = createMockEnv(() => {
			reads++;
			return { success: true, results: [] };
		});
		let key = '';
		env.SEARCH_CLIENT_LIMIT.limit = async (options) => {
			key = options.key;
			return { success: false };
		};
		const { res } = await dispatch(path, env, { headers: { 'CF-Connecting-IP': '203.0.113.5' } });
		expect(res.status).toBe(429);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Retry-After')).toBe('60');
		expect(key).toBe('client:203.0.113.5');
		expect(reads).toBe(0);
	});

	it.each(['/api/search.json?q=needle', '/search/?q=needle'])('denies %s before D1 when the location limit is reached', async (path) => {
		let reads = 0;
		const env = createMockEnv(() => {
			reads++;
			return { success: true, results: [] };
		});
		let key = '';
		env.SEARCH_LOCATION_LIMIT.limit = async (options) => {
			key = options.key;
			return { success: false };
		};
		const { res } = await dispatch(path, env);
		expect(res.status).toBe(429);
		expect(key).toBe('search');
		expect(reads).toBe(0);
	});

	it('uses a shared fallback key and ignores forwarded client claims', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		let key = '';
		env.SEARCH_CLIENT_LIMIT.limit = async (options) => {
			key = options.key;
			return { success: false };
		};
		await dispatch('/api/search.json?q=needle', env, { headers: { 'X-Forwarded-For': '192.0.2.1' } });
		expect(key).toBe('client:unknown');
		await dispatch('/api/search.json?q=needle', env, { headers: { 'CF-Connecting-IP': 'invalid value' } });
		expect(key).toBe('client:unknown');
	});

	it('fails closed if a configured binding is absent or unavailable', async () => {
		let reads = 0;
		const env = createMockEnv(() => {
			reads++;
			return { success: true, results: [] };
		});
		const missingLocation = env.SEARCH_LOCATION_LIMIT;
		// Simulate a deployment with a missing binding.
		Object.defineProperty(env, 'SEARCH_LOCATION_LIMIT', { configurable: true, value: undefined });
		let res = (await dispatch('/api/search.json?q=needle', env)).res;
		expect(res.status).toBe(503);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		Object.defineProperty(env, 'SEARCH_LOCATION_LIMIT', { configurable: true, value: missingLocation });
		env.SEARCH_CLIENT_LIMIT.limit = async () => {
			throw new Error('binding unavailable');
		};
		res = (await dispatch('/search/?q=needle', env)).res;
		expect(res.status).toBe(503);
		expect(reads).toBe(0);
	});

	it('does not call the limits for a query that cannot scan content', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		env.SEARCH_CLIENT_LIMIT.limit = async () => {
			throw new Error('unexpected rate-limit call');
		};
		expect((await dispatch('/api/search.json?q=x', env)).res.status).toBe(200);
		expect((await dispatch('/search/?q=x', env)).res.status).toBe(200);
	});

	it.each(['/api/search.json?q=x&p=42', '/search/?q=x&p=42'])('checks %s before looking up a filtered speaker', async (path) => {
		let reads = 0;
		const env = createMockEnv(() => {
			reads++;
			return { success: true, results: [] };
		});
		env.SEARCH_CLIENT_LIMIT.limit = async () => ({ success: false });
		const { res } = await dispatch(path, env);
		expect(res.status).toBe(429);
		expect(reads).toBe(0);
	});

	it('skips the section count only for the JSON endpoint', async () => {
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
