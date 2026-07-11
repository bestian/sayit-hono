import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import { createMockEnv, dispatch } from './helpers/mockEnv';

describe('/speeches/ render (happy path without R2 preseed)', () => {
	it('renders HTML from DB and stores it behind a data-versioned R2 key', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('SELECT filename, display_name FROM speech_index ORDER BY id ASC')) {
				return {
					success: true,
					results: [
						{ filename: '2026-a-demo', display_name: 'A Demo' },
						{ filename: '2026-b-demo', display_name: 'B Demo' },
					],
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/speeches/', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('A Demo');
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400');
		const speechCacheKeys = Array.from(env.__r2Store.keys()).filter((key) =>
			key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`),
		);
		expect(speechCacheKeys).toHaveLength(1);
	});

	it('serves preseeded R2 body when data-versioned key still matches', async () => {
		const rows = [{ filename: '2026-a-demo', display_name: 'A Demo' }];
		const env = createMockEnv((sql) => {
			if (sql.includes('SELECT filename, display_name FROM speech_index ORDER BY id ASC')) {
				return { success: true, results: rows };
			}
			return { success: true, results: [] };
		});

		// 第一次呼叫填入 R2，cache key 由 dataToken 決定
		const first = await dispatch('/speeches/', env);
		expect(first.res.status).toBe(200);
		const [cacheKey] = Array.from(env.__r2Store.keys()).filter((key) => key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`));
		expect(cacheKey).toBeDefined();

		// 把同一把 key 改成 sentinel，第二次呼叫應該命中 R2 直接回傳
		env.__r2Store.set(cacheKey!, {
			body: '<!doctype html><title>cached</title><body>SPEECHES-FROM-R2</body>',
			cacheControl: 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400',
			contentType: 'text/html; charset=utf-8',
			etag: null,
		});

		const second = await dispatch('/speeches/', env);
		expect(second.res.status).toBe(200);
		expect(await second.res.text()).toContain('SPEECHES-FROM-R2');
	});

	it('misses old speeches R2 HTML when the speech list data changes', async () => {
		let rows = [{ filename: '2026-a-demo', display_name: 'A Demo' }];
		const env = createMockEnv((sql) => {
			if (sql.includes('SELECT filename, display_name FROM speech_index ORDER BY id ASC')) {
				return { success: true, results: rows };
			}
			return { success: true, results: [] };
		});

		const first = await dispatch('/speeches/', env);
		expect(await first.res.text()).toContain('A Demo');
		const [oldKey] = Array.from(env.__r2Store.keys()).filter((key) => key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`));
		expect(oldKey).toBeDefined();
		env.__r2Store.set(oldKey!, {
			body: '<!doctype html><title>OLD</title><body>OLD-CACHED</body>',
			cacheControl: 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400',
			contentType: 'text/html; charset=utf-8',
			etag: null,
		});

		rows = [{ filename: '2026-b-demo', display_name: 'B Demo' }];
		const second = await dispatch('/speeches/', env);
		const html = await second.res.text();
		expect(html).toContain('B Demo');
		expect(html).not.toContain('OLD-CACHED');
		const speechCacheKeys = Array.from(env.__r2Store.keys()).filter((key) =>
			key.startsWith(`${CACHE_KEY_VERSION}/example.com/speeches/data-`),
		);
		expect(speechCacheKeys).toHaveLength(2);
	});
});

describe('/speakers/ R2 cache hit', () => {
	it('returns the preseeded body without calling DB', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/speakers/`;
		const env = createMockEnv(() => ({ success: false, results: [] }), {
			preSeedR2: { [cacheKey]: { body: '<!doctype html><title>SEED</title>SPEAKERS-SEED' } },
		});
		const { res } = await dispatch('/speakers/', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('SPEAKERS-SEED');
	});
});

describe('serveBucketJson surfaces ETag', () => {
	it('exposes the ETag header when R2 has one', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { 'stats.json': { body: '{"n":1}', etag: '"abc"', contentType: 'application/json; charset=utf-8' } },
		});
		const { res } = await dispatch('/stats.json', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('ETag')).toBe('"abc"');
	});
});

describe('rss decodeHtmlEntities fallback when URL fails to parse', () => {
	// buildCacheKey in rss.ts has a fallback path that strips protocol manually.
	// It's only hit when `new URL(...)` throws; virtually unreachable in normal flow,
	// but we include an integration-level smoke to keep the handler wired up.
	it('still produces XML for an unusual host URL', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_index si') && sql.includes('first_section_content')) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		expect(res.headers.get('content-type')).toContain('application/rss+xml');
	});
});
