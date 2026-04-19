import { describe, expect, it } from 'vitest';
import {
	deleteEdgeCache,
	deleteR2Cache,
	readEdgeCache,
	readR2Cache,
	writeEdgeCache,
	writeR2Cache
} from '../src/api/cache';

function createBucket() {
	const store = new Map<string, { body: string; cacheControl?: string; contentType?: string; etag?: string }>();
	return {
		store,
		bucket: {
			get: async (key: string) => {
				const entry = store.get(key);
				if (!entry) return null;
				return {
					body: entry.body,
					size: entry.body.length,
					httpEtag: entry.etag ?? null,
					httpMetadata: { cacheControl: entry.cacheControl, contentType: entry.contentType },
					text: async () => entry.body
				};
			},
			put: async (key: string, body: string, options?: { httpMetadata?: { cacheControl?: string; contentType?: string } }) => {
				store.set(key, { body, cacheControl: options?.httpMetadata?.cacheControl, contentType: options?.httpMetadata?.contentType });
			},
			delete: async (keys: string | string[]) => {
				for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
			}
		} as unknown as R2Bucket
	};
}

describe('cache.readR2Cache / writeR2Cache', () => {
	it('round-trips body and honors stored metadata', async () => {
		const { bucket, store } = createBucket();
		await writeR2Cache(bucket, 'k1', new Response('hi', {
			headers: { 'Cache-Control': 'public, max-age=10', 'Content-Type': 'text/plain' }
		}));
		expect(store.get('k1')).toMatchObject({
			body: 'hi',
			cacheControl: 'public, max-age=10',
			contentType: 'text/plain'
		});

		const res = await readR2Cache(bucket, 'k1');
		expect(res).not.toBeNull();
		expect(res!.status).toBe(200);
		expect(res!.headers.get('Cache-Control')).toBe('public, max-age=10');
		expect(res!.headers.get('Content-Type')).toBe('text/plain');
		expect(await res!.text()).toBe('hi');
	});

	it('returns null when the object is missing', async () => {
		const { bucket } = createBucket();
		expect(await readR2Cache(bucket, 'missing')).toBeNull();
	});

	it('surfaces ETag and Content-Length when the R2 object exposes them', async () => {
		const { bucket, store } = createBucket();
		store.set('k2', { body: 'abc', cacheControl: 'public, max-age=5', contentType: 'text/plain', etag: '"demo"' });
		const res = await readR2Cache(bucket, 'k2');
		expect(res?.headers.get('ETag')).toBe('"demo"');
		expect(res?.headers.get('Content-Length')).toBe('3');
	});

	it('falls back to default metadata when nothing is stored', async () => {
		const { bucket, store } = createBucket();
		store.set('k3', { body: 'x', cacheControl: undefined, contentType: undefined });
		const res = await readR2Cache(bucket, 'k3');
		expect(res?.headers.get('Cache-Control')).toBe('public, max-age=3600');
		expect(res?.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
	});

	it('swallows errors from a broken bucket in read/write', async () => {
		const broken = {
			get: async () => { throw new Error('io'); },
			put: async () => { throw new Error('io'); },
			delete: async () => { throw new Error('io'); }
		} as unknown as R2Bucket;

		expect(await readR2Cache(broken, 'k')).toBeNull();
		await writeR2Cache(broken, 'k', new Response('x'));
		await deleteR2Cache(broken, 'k');
	});
});

describe('cache.normalizeEdgeCacheKey paths via readEdgeCache/writeEdgeCache', () => {
	const urls = [
		'https://example.com/already-url',
		'example.com/host-like',
		'cache/plain-local'
	];

	for (const url of urls) {
		it(`round-trips via edge cache for key shape: ${url}`, async () => {
			await writeEdgeCache(url, new Response(`body-for-${url}`), 'public, max-age=60');
			const res = await readEdgeCache(url);
			expect(res).not.toBeNull();
			expect(await res!.text()).toBe(`body-for-${url}`);
			expect(res!.headers.get('Cache-Control')).toBe('public, max-age=60');
			await deleteEdgeCache(url);
			expect(await readEdgeCache(url)).toBeNull();
		});
	}

	it('accepts leading slash and routes through edge-cache.local', async () => {
		await writeEdgeCache('/leading-slash-key', new Response('yes'), 'public, max-age=60');
		const res = await readEdgeCache('/leading-slash-key');
		expect(await res!.text()).toBe('yes');
		await deleteEdgeCache('/leading-slash-key', { silent: true });
	});
});
