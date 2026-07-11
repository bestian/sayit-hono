import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import { createMockEnv, dispatch, type QueryResolver } from './helpers/mockEnv';

describe('/og/speech/:id.png', () => {
	it('serves a cached PNG from SPEECH_CACHE when present', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { [`${CACHE_KEY_VERSION}/og/speech/42.png`]: { body: 'PNG-bytes', contentType: 'image/png' } },
		});
		const { res } = await dispatch('/og/speech/42.png', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/png');
		expect(await res.text()).toBe('PNG-bytes');
	});

	it('returns 404 when no section row exists', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/og/speech/99.png', env);
		expect(res.status).toBe(404);
	});

	it('returns 500 when loadSection throws', async () => {
		const env = createMockEnv((sql) => {
			if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) throw new Error('boom');
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/og/speech/42.png', env);
		expect(res.status).toBe(500);
	});
});

describe('/og/*', () => {
	it('serves a cached PNG from SPEECH_CACHE for /og/<filename>.png', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { [`${CACHE_KEY_VERSION}/og/2026-demo.png`]: { body: 'PNG-bytes', contentType: 'image/png' } },
		});
		const { res } = await dispatch('/og/2026-demo.png', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('PNG-bytes');
	});

	it('returns 404 for unknown speech meta', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) return { success: true, results: [] };
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/og/unknown.png', env);
		expect(res.status).toBe(404);
	});
});
