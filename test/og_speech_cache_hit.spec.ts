import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import { createMockEnv, dispatch } from './helpers/mockEnv';

describe('og speech R2 hit tagging', () => {
	it('sets Cache-Tag when sections lookup returns filename', async () => {
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const env = createMockEnv(
			(sql) => {
				if (sql.includes('FROM sections WHERE section_id')) {
					return { success: true, results: [{ filename: 'demo-speech' }] };
				}
				return { success: true, results: [] };
			},
			{ preSeedR2: { [`${CACHE_KEY_VERSION}/og/speech/7.png`]: { body: png, contentType: 'image/png' } } },
		);
		const { res } = await dispatch('/og/speech/7.png', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Tag')).toContain('speech:');
	});

	it('still serves cached PNG when sections lookup throws', async () => {
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const env = createMockEnv(
			() => {
				throw new Error('db down');
			},
			{ preSeedR2: { [`${CACHE_KEY_VERSION}/og/speech/8.png`]: { body: png, contentType: 'image/png' } } },
		);
		const { res } = await dispatch('/og/speech/8.png', env);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('image/png');
	});
});
