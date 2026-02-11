const DEFAULT_CACHE_CONTROL = 'public, max-age=3600';

function normalizeEdgeCacheKey(cacheKey: string): string {
	try {
		return new URL(cacheKey).toString();
	} catch {
		const trimmed = cacheKey.startsWith('/') ? cacheKey.slice(1) : cacheKey;
		const firstSegment = trimmed.split('/')[0] ?? '';
		const looksLikeHost = firstSegment.includes('.') || firstSegment.includes(':');
		return looksLikeHost ? `https://${trimmed}` : `https://edge-cache.local/${trimmed}`;
	}
}

/** 從 Edge Cache 讀取快取 */
export async function readEdgeCache(cacheKey: string): Promise<Response | null> {
	try {
		const normalizedKey = normalizeEdgeCacheKey(cacheKey);
		const cached = await caches.default.match(normalizedKey);
		return cached ?? null;
	} catch (err) {
		console.error('[edge cache] read error', err);
		return null;
	}
}

/** 寫入 Edge Cache */
export async function writeEdgeCache(
	cacheKey: string,
	response: Response,
	defaultCacheControl = DEFAULT_CACHE_CONTROL
) {
	try {
		console.log('writing to edge cache', cacheKey);
		const normalizedKey = normalizeEdgeCacheKey(cacheKey);
		const cloned = response.clone();
		const res = new Response(cloned.body, response);
		res.headers.set('Cache-Control', response.headers.get('Cache-Control') ?? defaultCacheControl);
		await caches.default.put(normalizedKey, res);
	} catch (err) {
		console.error('[edge cache] write error', err);
	}
}

/** 刪除 Edge Cache */
export async function deleteEdgeCache(cacheKey: string) {
	try {
		const normalizedKey = normalizeEdgeCacheKey(cacheKey);
		await caches.default.delete(normalizedKey);
		console.log('[edge cache] deleted', cacheKey);
	} catch (err) {
		console.error('[edge cache] delete error', cacheKey, err);
	}
}

/** 從 R2 讀取快取，回傳 Response 或 null */
export async function readR2Cache(
	bucket: R2Bucket,
	cacheKey: string,
	defaultContentType = 'text/html; charset=utf-8'
): Promise<Response | null> {
	try {
		console.log('reading from r2 cache', cacheKey);
		const object = await bucket.get(cacheKey);
		if (!object) return null;

		const body = await object.text();
		const headers = new Headers();
		const cacheControl = object.httpMetadata?.cacheControl ?? DEFAULT_CACHE_CONTROL;
		const contentType = object.httpMetadata?.contentType ?? defaultContentType;

		headers.set('Cache-Control', cacheControl);
		headers.set('Content-Type', contentType);

		if (typeof object.size === 'number') {
			headers.set('Content-Length', object.size.toString());
		}
		if (object.httpEtag) {
			headers.set('ETag', object.httpEtag);
		}

		return new Response(body, { status: 200, headers });
	} catch (err) {
		console.error('[r2 cache] read error', err);
		return null;
	}
}

/** 寫入 R2 快取 */
export async function writeR2Cache(
	bucket: R2Bucket,
	cacheKey: string,
	response: Response,
	defaultContentType = 'text/html; charset=utf-8'
) {
	try {
		const cloned = response.clone();
		const body = await cloned.text();
		const cacheControl = cloned.headers.get('Cache-Control') ?? DEFAULT_CACHE_CONTROL;
		const contentType = cloned.headers.get('Content-Type') ?? defaultContentType;

		await bucket.put(cacheKey, body, {
			httpMetadata: {
				cacheControl,
				contentType
			}
		});
	} catch (err) {
		console.error('[r2 cache] write error', err);
	}
}

/** 刪除 R2 快取 */
export async function deleteR2Cache(bucket: R2Bucket, cacheKey: string) {
	try {
		await bucket.delete(cacheKey);
		console.log('[r2 cache] deleted', cacheKey);
	} catch (err) {
		console.error('[r2 cache] delete error', cacheKey, err);
	}
}
