import { describe, expect, it } from 'vitest';
import {
	buildR2HtmlKey,
	CACHE_KEY_VERSION,
	deleteR2Cache,
	purgeWorkersCache,
	r2AnKey,
	r2MdKey,
	r2OgSectionKey,
	r2OgSpeechKey,
	readR2Cache,
	speechRequestPath,
	speakerRequestPath,
	tags,
	writeR2Cache,
	type PurgeOptions
} from '../src/api/cache';

function createBucket() {
	const store = new Map<string, { body: string; cacheControl?: string; contentType?: string; etag?: string; customMetadata?: Record<string, string> }>();
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
					customMetadata: entry.customMetadata,
					text: async () => entry.body
				};
			},
			put: async (key: string, body: string, options?: { httpMetadata?: { cacheControl?: string; contentType?: string }; customMetadata?: Record<string, string> }) => {
				store.set(key, {
					body,
					cacheControl: options?.httpMetadata?.cacheControl,
					contentType: options?.httpMetadata?.contentType,
					customMetadata: options?.customMetadata
				});
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

	it('preserves Cache-Tag via customMetadata', async () => {
		const { bucket } = createBucket();
		await writeR2Cache(bucket, 'tagged', new Response('<html/>', {
			headers: {
				'Cache-Control': 'public, max-age=0',
				'Content-Type': 'text/html',
				'Cache-Tag': 'list:home,speech:demo'
			}
		}));
		const res = await readR2Cache(bucket, 'tagged');
		expect(res?.headers.get('Cache-Tag')).toBe('list:home,speech:demo');
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

describe('cache key taxonomy helpers', () => {
	it('builds versioned hostful HTML keys only', () => {
		expect(buildR2HtmlKey('https://example.com/speeches/?q=1')).toBe(
			`${CACHE_KEY_VERSION}/example.com/speeches/?q=1`
		);
		expect(buildR2HtmlKey('https://example.com/speeches/?q=1', { includeSearch: false })).toBe(
			`${CACHE_KEY_VERSION}/example.com/speeches/`
		);
	});

	it('keeps stable an/md keys and versioned OG keys separate', () => {
		expect(r2AnKey('demo')).toBe('an/demo');
		expect(r2MdKey('demo')).toBe('md/demo');
		expect(r2OgSpeechKey('demo')).toBe(`${CACHE_KEY_VERSION}/og/demo.png`);
		expect(r2OgSectionKey(42)).toBe(`${CACHE_KEY_VERSION}/og/speech/42.png`);
	});

	it('exports list and entity tags', () => {
		expect(tags.listHome).toBe('list:home');
		expect(tags.speech('a b')).toBe(`speech:${encodeURIComponent('a b')}`);
		expect(tags.speaker('audrey-tang')).toBe(`speaker:${encodeURIComponent('audrey-tang')}`);
	});
});

describe('purgeWorkersCache option shape', () => {
	it('is a unary function and accepts PurgeOptions objects', () => {
		expect(typeof purgeWorkersCache).toBe('function');
		expect(purgeWorkersCache.length).toBe(1);
		const byTags: PurgeOptions = { tags: [tags.listHome] };
		const byPrefix: PurgeOptions = { pathPrefixes: ['/speech/1'] };
		const everything: PurgeOptions = { purgeEverything: true };
		expect(byTags).toBeTruthy();
		expect(byPrefix).toBeTruthy();
		expect(everything).toBeTruthy();
	});
});

describe('speech/speaker request paths', () => {
	it('percent-encodes CJK speech filenames for pathPrefixes', () => {
		const filename = '2025-11-10-柏林自由會議-ai-的角色';
		expect(speechRequestPath(filename)).toBe(`/${encodeURIComponent(filename)}`);
		expect(speechRequestPath(filename)).not.toContain('柏');
	});

	it('uses stored speaker route keys without double-encoding', () => {
		expect(speakerRequestPath('audrey-tang')).toBe('/speaker/audrey-tang');
		const encoded = encodeURIComponent('唐鳳-3');
		expect(speakerRequestPath(encoded)).toBe(`/speaker/${encoded}`);
		// already-encoded input must not gain another %25 layer
		expect(speakerRequestPath(encoded)).not.toContain('%25');
	});
});
