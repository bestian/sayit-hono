import { cache } from 'cloudflare:workers';
import { CACHE_KEY_VERSION } from '../cacheKeyVersion';

const DEFAULT_CACHE_CONTROL = 'public, max-age=3600';

// Bump when cached HTML format changes to invalidate stale R2 origin entries.
export { CACHE_KEY_VERSION };

/** Front-of-Worker s-maxage for default HTML pages. */
export const EDGE_TTL_SECONDS = 300;
export const DEFAULT_HTML_CACHE_CONTROL =
	`public, max-age=0, must-revalidate, s-maxage=${EDGE_TTL_SECONDS}, stale-while-revalidate=86400`;
export const SEARCH_API_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
export const SEARCH_HTML_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
export const FEED_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
export const ARTIFACT_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';
export const OG_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';

/** Cache-Tag values for Workers Cache purge. */
export const tags = {
	listHome: 'list:home',
	listSpeeches: 'list:speeches',
	listSpeakers: 'list:speakers',
	listRss: 'list:rss',
	listPrivacy: 'list:privacy',
	listTerms: 'list:terms',
	listSearch: 'list:search',
	speech: (filename: string) => `speech:${encodeURIComponent(filename)}`,
	speaker: (routePathname: string) => `speaker:${encodeURIComponent(routePathname)}`
} as const;

/**
 * R2 origin keys for SSR HTML + RSS only — NOT for an/md/search/OG.
 * Shape: `${CACHE_KEY_VERSION}/${host}${pathname}[?search]`
 */
export function buildR2HtmlKey(
	url: string,
	{ includeSearch = true }: { includeSearch?: boolean } = {}
): string {
	const u = new URL(url);
	return `${CACHE_KEY_VERSION}/${u.host}${u.pathname}${includeSearch ? u.search : ''}`;
}

/** Stable (unversioned) R2 key for full-speech .an artifacts. */
export function r2AnKey(filename: string): string {
	return `an/${filename}`;
}

/** Stable (unversioned) R2 key for full-speech .md artifacts. */
export function r2MdKey(filename: string): string {
	return `md/${filename}`;
}

/** Versioned R2 key for speech OG PNG. */
export function r2OgSpeechKey(filename: string): string {
	return `${CACHE_KEY_VERSION}/og/${filename}.png`;
}

/** Versioned R2 key for section OG PNG. */
export function r2OgSectionKey(sectionId: number | string): string {
	return `${CACHE_KEY_VERSION}/og/speech/${sectionId}.png`;
}

/** Attach Cache-Control and optional Cache-Tag for front Workers Cache. */
export function withCacheHeaders(
	response: Response,
	cacheControl = DEFAULT_HTML_CACHE_CONTROL,
	tagList?: string[]
): Response {
	const res = new Response(response.body, response);
	res.headers.set('Cache-Control', cacheControl);
	if (tagList && tagList.length > 0) {
		res.headers.set('Cache-Tag', tagList.join(','));
	}
	return res;
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

		const cacheTag = object.customMetadata?.cacheTag;
		if (cacheTag) {
			headers.set('Cache-Tag', cacheTag);
		}

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
		const cacheTag = cloned.headers.get('Cache-Tag') ?? undefined;

		await bucket.put(cacheKey, body, {
			httpMetadata: {
				cacheControl,
				contentType
			},
			...(cacheTag ? { customMetadata: { cacheTag } } : {})
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

export type PurgeOptions =
	| { tags: string[]; pathPrefixes?: string[] }
	| { pathPrefixes: string[]; tags?: string[] }
	| { purgeEverything: true };

/**
 * Purge front-of-Worker Workers Cache.
 * pathPrefixes are true prefixes — never pass '/' for "home only"; use tags for exact list pages.
 * Prefer tags-only or pathPrefixes-only calls; combining is allowed but a bad prefix must not
 * block tags — callers should split when prefixes may be untrusted.
 */
export async function purgeWorkersCache(options: PurgeOptions): Promise<void> {
	try {
		console.log('[workers cache] purging', options);
		const result = await cache.purge(options);
		console.log('[workers cache] purge result', result);
		if (result && typeof result === 'object' && 'success' in result && result.success === false) {
			console.error('[workers cache] purge reported failure', result);
		}
	} catch (err) {
		console.error('[workers cache] purge error', err);
	}
}

/** Canonical request path for a speech filename (percent-encoded; no raw Unicode). */
export function speechRequestPath(filename: string): string {
	return `/${encodeURIComponent(filename)}`;
}

/** Canonical request path for a speaker route. */
export function speakerRequestPath(routePathname: string): string {
	return `/speaker/${encodeURIComponent(routePathname)}`;
}
