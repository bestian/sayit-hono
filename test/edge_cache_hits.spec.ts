import { describe, expect, it } from 'vitest';
import { createMockEnv, dispatch, type MockR2Entry } from './helpers/mockEnv';

function makeEnv(preSeedR2: Record<string, { body: string; contentType?: string; cacheControl?: string; cacheTag?: string }>) {
	const entries: Record<string, MockR2Entry> = {};
	for (const [k, v] of Object.entries(preSeedR2)) {
		entries[k] = {
			body: v.body,
			contentType: v.contentType,
			cacheControl: v.cacheControl ?? 'public, max-age=3600, s-maxage=3600',
			customMetadata: v.cacheTag ? { cacheTag: v.cacheTag } : undefined,
		};
	}
	return createMockEnv(() => ({ success: true, results: [] }), { preSeedR2: entries });
}

describe('an origin cache (R2)', () => {
	it('serves an R2-cached body and ignores DB', async () => {
		const env = makeEnv({
			'an/demo-edge': {
				body: 'R2-AN',
				contentType: 'text/plain; charset=utf-8',
				cacheTag: 'speech:demo-edge',
			},
		});
		const { res } = await dispatch('/api/an/demo-edge.an', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('R2-AN');
		expect(res.headers.get('Cache-Tag')).toContain('speech:');
		expect(res.headers.get('Cache-Control') || '').toMatch(/s-maxage=/);
	});

	it('HEAD on R2-cached an returns empty body', async () => {
		const env = makeEnv({
			'an/demo-edge-head': {
				body: 'R2-AN',
				contentType: 'text/plain; charset=utf-8',
				cacheTag: 'speech:demo-edge-head',
			},
		});
		const { res } = await dispatch('/api/an/demo-edge-head.an', env, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
	});
});

describe('md origin cache (R2)', () => {
	it('serves an R2-cached body and ignores DB', async () => {
		const env = makeEnv({
			'md/demo-edge-md': {
				body: 'R2-MD',
				contentType: 'text/markdown; charset=utf-8',
				cacheTag: 'speech:demo-edge-md',
			},
		});
		const { res } = await dispatch('/api/md/demo-edge-md.md', env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('R2-MD');
		expect(res.headers.get('Cache-Tag')).toContain('speech:');
	});
});
