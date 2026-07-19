declare const __LOCAL_D1_SEED__: boolean;

import { Hono, type Context } from 'hono';
import { speechIndex } from './api/speech_index';
import { handleOptions } from './api/cors';
import { CACHE_KEY_VERSION, SEARCH_API_CACHE_CONTROL, purgeWorkersCache, tags, withCacheHeaders } from './api/cache';

import { speakersIndex } from './api/speakers_index';
import { speakerDetail } from './api/speaker_detail';
import { speechContent } from './api/speech';
import { sectionDetail } from './api/section';
import { speechAn, serveAnByKey } from './api/an';
import { serveMdByKey } from './api/md';
import { uploadMarkdown } from './api/upload_markdown';
import { redirectsSync } from './api/redirects';
import { isAuthorizedFromHeader } from './api/auth';
import { rssFeed } from './api/rss';
import { handleOgImage, handleOgSpeechImage } from './api/og_routes';
import { ogLoader } from './api/og_loader';
import {
	SEARCH_INDEX_BASELINE_BR_KEY,
	SEARCH_INDEX_BASELINE_KEY,
	SEARCH_INDEX_MANIFEST_KEY,
	SEARCH_STATS_KEY,
	SEARCH_UPDATES_PREFIX,
	createEmptySearchOverlayManifest,
} from './search/indexFormat';
import { decodeHtmlEntities } from './utils/textUtils';
import { extractDate } from './search/docBuilder';

import type { WorkerEnv } from './ssr/pages/shared';
import { isExcludedPath } from './ssr/pages/shared';
import { renderHomePage, renderSpeechesPage, renderSpeakersPage, renderPrivacyPage, renderTermsPage } from './ssr/pages/home';
import { normalizeSearchQuery, runSearchQuery, renderSearchPage, SEARCH_DEFAULT_PAGE_SIZE, SEARCH_MAX_PAGE_SIZE } from './ssr/pages/search';
import { renderSectionPage, renderNestedSpeechPage, renderSpeechPage } from './ssr/pages/speech';
import { renderSpeakerPage } from './ssr/pages/speaker';

const app = new Hono<{ Bindings: WorkerEnv }>();
// The dynamic import is intentionally compile-time gated so production builds do not include dev-only SQL.
if (typeof __LOCAL_D1_SEED__ !== 'undefined' && __LOCAL_D1_SEED__) {
	app.use('*', async (c, next) => {
		const { ensureLocalIndexes } = await import('./db/local-dev-seed');
		await ensureLocalIndexes(c.env.DB);
		await next();
	});
}

function normalizeSpeakerPageSearch(url: URL): string {
	const rawPage = url.searchParams.get('page');
	if (rawPage == null) return '';

	const page = Number(rawPage);
	if (!Number.isInteger(page) || page < 2) return '';

	return `?page=${page}`;
}

function buildCanonicalPageUrl(requestUrl: string): string | null {
	const url = new URL(requestUrl);
	const { pathname, search } = url;
	const segments = pathname.split('/').filter(Boolean);
	const lastSegment = segments[segments.length - 1] ?? '';
	const isTopLevelSpeechPath = segments.length === 1 && !isExcludedPath(segments[0]) && !lastSegment.includes('.');
	const isNestedSpeechPath = segments.length === 2 && !isExcludedPath(segments[0]) && !lastSegment.includes('.');
	const isSectionPagePath = segments.length === 2 && segments[0] === 'speech' && /^\d+$/.test(segments[1]);
	const isSpeakerPagePath = segments.length === 2 && segments[0] === 'speaker';

	let canonicalPath = pathname;
	let canonicalSearch = search;

	if (pathname === '/index.html') {
		canonicalPath = '/';
	} else if (pathname === '/speeches') {
		canonicalPath = '/speeches/';
	} else if (pathname === '/speakers') {
		canonicalPath = '/speakers/';
	} else if (pathname === '/search') {
		canonicalPath = '/search/';
	}

	if (
		pathname === '/' ||
		pathname === '/index.html' ||
		pathname === '/speeches' ||
		pathname === '/speeches/' ||
		pathname === '/speakers' ||
		pathname === '/speakers/' ||
		isTopLevelSpeechPath ||
		isNestedSpeechPath ||
		isSectionPagePath
	) {
		canonicalSearch = '';
	} else if (isSpeakerPagePath) {
		canonicalSearch = normalizeSpeakerPageSearch(url);
	} else if (pathname === '/search' || pathname === '/search/') {
		canonicalSearch = search;
	} else {
		return null;
	}

	if (canonicalPath === pathname && canonicalSearch === search) {
		return null;
	}

	const canonicalUrl = new URL(url.toString());
	canonicalUrl.pathname = canonicalPath;
	canonicalUrl.search = canonicalSearch;
	return canonicalUrl.toString();
}

async function canonicalHtmlPageMiddleware(c: Context<{ Bindings: WorkerEnv }>, next: () => Promise<void>) {
	if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
		return next();
	}

	const canonicalUrl = buildCanonicalPageUrl(c.req.url);
	if (!canonicalUrl) {
		return next();
	}

	const response = c.redirect(canonicalUrl, 302);
	response.headers.set('Cache-Control', 'no-store');
	return response;
}

app.use('*', canonicalHtmlPageMiddleware);

// 靜態檔優先：先嘗試 ASSETS（Cloudflare CI 建置），找不到再走 API/SSR
app.use('*', staticFirstMiddleware);

function requestAcceptsBrotli(c: Context<{ Bindings: WorkerEnv }>): boolean {
	const acceptEncoding = c.req.header('Accept-Encoding') ?? '';
	return /\bbr\b/i.test(acceptEncoding);
}

async function serveBucketJson(
	c: Context<{ Bindings: WorkerEnv }>,
	key: string,
	{
		cacheControl,
		contentEncoding,
	}: {
		cacheControl: string;
		contentEncoding?: string;
	},
): Promise<Response | null> {
	const object = await c.env.SPEECH_CACHE.get(key);
	if (!object) return null;

	const headers = new Headers();
	headers.set('Content-Type', 'application/json; charset=utf-8');
	headers.set('Cache-Control', cacheControl);
	if (contentEncoding) {
		headers.set('Content-Encoding', contentEncoding);
		headers.set('Vary', 'Accept-Encoding');
	}
	headers.set('Content-Length', object.size.toString());
	if (object.httpEtag) {
		headers.set('ETag', object.httpEtag);
	}

	return new Response(object.body, { headers });
}

/** 向 Cloudflare 靜態資源 (ASSETS) 要求檔案，使用請求 URL */
async function serveAsset(c: Context<{ Bindings: WorkerEnv }>): Promise<Response> {
	const url = new URL(c.req.url);
	return c.env.ASSETS.fetch(url.toString());
}

/** 優先嘗試從 ASSETS 回應靜態檔，找不到再交給後續 API/SSR 路由 */
async function staticFirstMiddleware(c: Context<{ Bindings: WorkerEnv }>, next: () => Promise<void>) {
	const pathname = new URL(c.req.url).pathname;
	if (
		pathname.startsWith('/api/') ||
		pathname.startsWith('/og/') ||
		pathname.startsWith('/speech/') ||
		pathname.startsWith('/speaker/') ||
		pathname.startsWith('/search-updates/') ||
		pathname === '/search-index.json' ||
		pathname === '/search-index-manifest.json' ||
		pathname === '/sections-dump.json' ||
		pathname === '/stats.json' ||
		pathname === '/version'
	)
		return next();
	if (
		pathname === '/' ||
		pathname === '/index.html' ||
		pathname === '/speeches' ||
		pathname === '/speeches/' ||
		pathname === '/speakers' ||
		pathname === '/speakers/'
	) {
		return next();
	}
	const res = await serveAsset(c);
	if (res && res.status >= 200 && res.status < 400) return res;
	return next();
}

// API CORS preflight
app.options('/api/*', (c) => handleOptions(c));

// Search index from R2
app.get('/search-index.json', async (c) => {
	const cacheControl = 'public, max-age=3600, s-maxage=86400';
	if (requestAcceptsBrotli(c)) {
		const compressed = await serveBucketJson(c, SEARCH_INDEX_BASELINE_BR_KEY, {
			cacheControl,
			contentEncoding: 'br',
		});
		if (compressed) return compressed;
	}
	const response = await serveBucketJson(c, SEARCH_INDEX_BASELINE_KEY, { cacheControl });
	return response ?? c.text('Not found', 404);
});

app.get('/search-index-manifest.json', async (c) => {
	const response = await serveBucketJson(c, SEARCH_INDEX_MANIFEST_KEY, {
		cacheControl: 'public, max-age=60, s-maxage=60',
	});
	if (response) return response;
	return c.json(createEmptySearchOverlayManifest(), 200, {
		'Cache-Control': 'public, max-age=60, s-maxage=60',
	});
});

app.get('/search-updates/:path{[^/]+\\.json}', async (c) => {
	const response = await serveBucketJson(c, `${SEARCH_UPDATES_PREFIX}/${c.req.param('path')}`, {
		cacheControl: 'public, max-age=3600, s-maxage=86400',
	});
	return response ?? c.text('Not found', 404);
});

app.get('/stats.json', async (c) => {
	const response = await serveBucketJson(c, SEARCH_STATS_KEY, {
		cacheControl: 'public, max-age=300, s-maxage=300',
	});
	if (response) return response;
	if (typeof __LOCAL_D1_SEED__ !== 'undefined' && __LOCAL_D1_SEED__) {
		const { readCanonicalSearchStats } = await import('./search/runtime');
		return c.json(await readCanonicalSearchStats(c.env.DB), 200, { 'Cache-Control': 'no-store' });
	}
	return c.text('Not found', 404);
});

app.get('/sections-dump.json', async (c) => {
	const obj = await c.env.SPEECH_CACHE.get('sections-dump.json');
	if (!obj) return c.text('Not found', 404);
	return new Response(obj.body, {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'public, max-age=3600, s-maxage=86400',
		},
	});
});

app.get('/version', (c) => c.json({ version: CACHE_KEY_VERSION }, 200, { 'Cache-Control': 'no-store' }));

// D1 APIs
app.get('/api/speech_index.json', (c) => speechIndex(c));
app.get('/api/speakers_index.json', (c) => speakersIndex(c));
app.get('/api/speaker_detail/:route_pathname_with_json', (c) => speakerDetail(c));
app.get('/api/speech/*', (c) => speechContent(c));
app.get('/api/section/:section_id', (c) => sectionDetail(c));
app.get('/api/search.json', async (c) => {
	const query = normalizeSearchQuery(c.req.query('q'));
	const requestedLimit = Number(c.req.query('limit') || SEARCH_DEFAULT_PAGE_SIZE);
	const limit = Number.isFinite(requestedLimit)
		? Math.max(1, Math.min(SEARCH_MAX_PAGE_SIZE, Math.floor(requestedLimit)))
		: SEARCH_DEFAULT_PAGE_SIZE;
	const speakerParam = Number(c.req.query('p') || '');
	const speakerId = Number.isFinite(speakerParam) && speakerParam > 0 ? Math.floor(speakerParam) : undefined;

	const searchResult = await runSearchQuery(c, { query, page: 1, pageSize: limit, speakerId });
	const results = searchResult.sections.map((row) => {
		const pageUrl = row.nest_filename
			? `/${encodeURIComponent(row.filename)}/${encodeURIComponent(row.nest_filename)}`
			: `/${encodeURIComponent(row.filename)}`;
		return {
			title: row.display_name,
			url: `${pageUrl}#s${row.section_id}`,
			date: extractDate(row.display_name ?? ''),
			speaker: row.speaker_name ?? '',
			snippet: decodeHtmlEntities(row.snippet.replace(/<\/?em>/g, '')),
		};
	});

	return withCacheHeaders(c.json({ results }), SEARCH_API_CACHE_CONTROL, [tags.listSearch]);
});

// /search is redirected to /search/ by the canonical-URL middleware.
app.get('/search/', (c) => renderSearchPage(c));
app.on(['GET', 'HEAD'], '/api/an/:path{[^/]+\\.an}', (c) => speechAn(c));
app.get('/api/md/:path{[^/]+\\.md}', async (c) => serveMdByKey(c, decodeURIComponent(c.req.param('path'))));
app.post('/api/upload_markdown', (c) => uploadMarkdown(c));
app.patch('/api/upload_markdown', (c) => uploadMarkdown(c));
app.delete('/api/upload_markdown', (c) => uploadMarkdown(c));
app.put('/api/redirects', (c) => redirectsSync(c));
app.on(['GET', 'HEAD'], '/rss.xml', (c) => rssFeed(c));
app.on(['GET', 'HEAD'], '/feed.xml', (c) => rssFeed(c));

// OG image for single-quote (section) pages — must be before /og/* wildcard
app.get('/og/speech/:section_id{\\d+\\.png}', (c) => handleOgSpeechImage(c, ogLoader));

// Dynamic OG image for speech pages
app.get('/og/*', (c) => handleOgImage(c, ogLoader));

app.post('/api/purge_cache', async (c) => {
	const authorized = await isAuthorizedFromHeader(
		c.req.header('Authorization'),
		c.env.AUDREYT_TRANSCRIPT_TOKEN,
		c.env.BESTIAN_TRANSCRIPT_TOKEN,
	);
	if (!authorized) return c.text('Forbidden', 403);

	// Front-only: skip R2 wipe (slow/timeout) and just purge Workers Cache.
	const frontOnly = new URL(c.req.url).searchParams.get('front_only') === '1';
	if (frontOnly) {
		const purged = await purgeWorkersCache({ purgeEverything: true });
		return c.json({ frontOnly: true, purged }, purged ? 200 : 503);
	}

	const bucket = c.env.SPEECH_CACHE;
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const list = await bucket.list({ cursor, limit: 500 });
		const keys = list.objects.map((o: { key: string }) => o.key);
		if (keys.length > 0) {
			await bucket.delete(keys);
			deleted += keys.length;
		}
		cursor = list.truncated ? list.cursor : undefined;
	} while (cursor);
	const purged = await purgeWorkersCache({ purgeEverything: true });
	return c.json({ deleted, purged }, purged ? 200 : 503);
});

app.post('/api/cleanup_old_cache', async (c) => {
	const authorized = await isAuthorizedFromHeader(
		c.req.header('Authorization'),
		c.env.AUDREYT_TRANSCRIPT_TOKEN,
		c.env.BESTIAN_TRANSCRIPT_TOKEN,
	);
	if (!authorized) return c.text('Forbidden', 403);

	const url = new URL(c.req.url);
	const maxDeletesParam = Number(url.searchParams.get('max_deletes') ?? '');
	const currentPrefix = `${CACHE_KEY_VERSION}/`;

	const bucket = c.env.SPEECH_CACHE;
	let deleted = 0;
	const LIST_LIMIT = 1000;
	const MAX_DELETES = Number.isFinite(maxDeletesParam) && maxDeletesParam > 0 ? Math.min(Math.floor(maxDeletesParam), 100000) : 100000;
	let cursor: string | undefined;
	do {
		const list = await bucket.list({ cursor, limit: LIST_LIMIT });
		const toDelete = list.objects.filter((o: { key: string }) => !o.key.startsWith(currentPrefix)).map((o: { key: string }) => o.key);
		if (toDelete.length > 0) {
			await bucket.delete(toDelete);
			deleted += toDelete.length;
		}
		cursor = list.truncated ? list.cursor : undefined;
		if (deleted >= MAX_DELETES) {
			return c.json({ deleted, more: true });
		}
	} while (cursor);
	return c.json({ deleted, more: false });
});

// /speeches → /speeches/, /speakers → /speakers/, /index.html → / are all redirected
// by the canonical-URL middleware before these handlers run.
app.get('/privacy', (c) => renderPrivacyPage(c));
app.get('/terms', (c) => renderTermsPage(c));
app.get('/speeches/', (c) => renderSpeechesPage(c));
app.get('/speakers/', (c) => renderSpeakersPage(c));
app.get('/', (c) => renderHomePage(c));

// /speech/:section_id -> .md/.an 轉專用處理，否則為動態段落頁
app.on(['GET', 'HEAD'], '/speech/:section_id', (c) => renderSectionPage(c));

// SSR 講者頁
app.get('/speaker/:route_pathname', (c) => renderSpeakerPage(c));

// favicon、robots、/media/*、/static/* 由 staticFirstMiddleware 從 ASSETS 提供

// SSR 巢狀演講內容頁（巢狀子項）
app.get('/:filename/:nest_filename', (c) => renderNestedSpeechPage(c));

// .md 檔案
app.on(['GET', 'HEAD'], '/:path{[^/]+\\.md}', (c) => serveMdByKey(c, c.req.param('path')));

// .an 檔案
app.on(['GET', 'HEAD'], '/:path{[^/]+\\.an}', (c) => serveAnByKey(c, c.req.param('path')));

// SSR 演講頁（單一演講或巢狀清單，直接用 filename 作為路徑；需置於最後的 catch-all 之前）
app.get('/:filename', (c) => renderSpeechPage(c));

// 其餘請求：靜態已由 middleware 嘗試過，未匹配則 404
app.get('*', (c) => c.text('Not Found', 404));

export default app;
