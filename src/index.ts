import { Hono } from 'hono';
import { speechIndex } from './api/speech_index';
import { handleOptions } from './api/cors';
import { deleteEdgeCache, readEdgeCache, readR2Cache, writeEdgeCache, writeR2Cache } from './api/cache';
import { speakersIndex } from './api/speakers_index';
import { speakerDetail } from './api/speaker_detail';
import { speechContent } from './api/speech';
import { sectionDetail } from './api/section';
import { speechAn, serveAnByKey } from './api/an';
import { serveMdByKey } from './api/md';
import { uploadMarkdown } from './api/upload_markdown';
import { rssFeed } from './api/rss';
import type { ApiEnv } from './api/types';
import HomeView, { styles as HomeViewStyles } from './.generated/views/HomeView';
import SingleParagraphView, { styles as SingleParagraphViewStyles } from './.generated/views/SingleParagraphView';
import SingleSpeechView, { styles as SingleSpeechViewStyles } from './.generated/views/SingleSpeechView';
import NestedSpeechView, { styles as NestedSpeechViewStyles } from './.generated/views/NestedSpeechView';
import SingleNestedSpeechView, { styles as SingleNestedSpeechViewStyles } from './.generated/views/SingleNestedSpeechView';
import SingleSpeakerView, { styles as SingleSpeakerViewStyles } from './.generated/views/SingleSpeakerView';
import SpeechesView, { styles as SpeechesViewStyles } from './.generated/views/SpeechesView';
import SpeakersView, { styles as SpeakersViewStyles } from './.generated/views/SpeakersView';
import Navbar, { styles as NavbarStyles } from './.generated/components/Navbar';
import Footer, { styles as FooterStyles } from './.generated/components/Footer';
import { renderHtml } from './ssr/render';
import {
	headForSpeechContent,
	headForSingleSpeech,
	headForSpeaker,
	headForNestedSpeech,
	headForNestedSpeechDetail,
	headForSpeeches,
	headForSpeakers,
	headForHome
} from './ssr/heads';
import { buildPaginationPages } from './utils/pagination';
import { normalizeSections } from './utils/sectionUtils';

type WorkerEnv = ApiEnv['Bindings'];

const app = new Hono<{ Bindings: WorkerEnv }>();

// 靜態檔優先：先嘗試 ASSETS（Cloudflare CI 建置），找不到再走 API/SSR
app.use('*', staticFirstMiddleware);

const EDGE_TTL_SECONDS = 60;
const DEFAULT_HTML_CACHE_CONTROL = `public, max-age=${EDGE_TTL_SECONDS}, s-maxage=${EDGE_TTL_SECONDS}`;
const PAGEFIND_SCRIPT = '<script src="/static/speeches/js/pagefind-search.js"></script>';
const STATS_SCRIPT = `<script>(function(){fetch('/stats.json').then(function(r){return r.json()}).then(function(s){var fmt=function(n){return n.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')};var e;e=document.getElementById('sayit-stat-speeches');if(e)e.textContent=fmt(s.speeches);e=document.getElementById('sayit-stat-speakers');if(e)e.textContent=fmt(s.speakers);e=document.getElementById('sayit-stat-sections');if(e)e.textContent=fmt(s.sections)}).catch(function(){})})()</script>`;

function buildCacheKey(url: string): string {
	try {
		const u = new URL(url);
		return `${u.host}${u.pathname}${u.search}`;
	} catch {
		// fallback: strip protocol manually
		return url.replace(/^https?:\/\//, '');
	}
}

function withCacheHeaders(response: Response): Response {
	const res = new Response(response.body, response);
	res.headers.set('Cache-Control', DEFAULT_HTML_CACHE_CONTROL);
	if (!res.headers.has('Content-Type')) {
		res.headers.set('Content-Type', 'text/html; charset=utf-8');
	}
	return res;
}

/** 向 Cloudflare 靜態資源 (ASSETS) 要求檔案，path 可指定子路徑，未指定則用請求 URL */
async function serveAsset(c: any, path?: string): Promise<Response> {
	const url = new URL(c.req.url);
	const assetUrl = path ? new URL(path, url) : url;
	return c.env.ASSETS.fetch(assetUrl.toString());
}

/** 優先嘗試從 ASSETS 回應靜態檔，找不到再交給後續 API/SSR 路由 */
async function staticFirstMiddleware(c: any, next: () => Promise<void>) {
	const pathname = new URL(c.req.url).pathname;
	if (pathname.startsWith('/api/')) return next();
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

function parseContent(raw?: string | null) {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'string' ? parsed : raw;
	} catch {
		return raw;
	}
}

function toPlainText(html: string) {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseToArray(raw?: string | null): string[] {
	if (!raw) return [];
	const parsed = parseContent(raw);
	if (Array.isArray(parsed)) return parsed.map((v) => `${v}`.trim()).filter(Boolean);
	if (typeof parsed === 'string') {
		return parsed
			.split(',')
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return [];
}

async function loadSection(c: any, sectionId: number) {
	const row = await c.env.DB.prepare(
		`SELECT
			a.filename,
			a.nest_filename,
			a.nest_display_name,
			a.section_id,
			a.previous_section_id,
			a.next_section_id,
			a.section_speaker,
			a.section_content,
			si.display_name,
			sp.photoURL,
			sp.name,
			prev_section.section_content AS previous_content,
			next_section.section_content AS next_content
		FROM speech_content a
		LEFT JOIN speech_index si ON a.filename = si.filename
		LEFT JOIN speakers sp ON a.section_speaker = sp.route_pathname
		LEFT JOIN speech_content prev_section ON a.section_id = prev_section.next_section_id
		LEFT JOIN speech_content next_section ON a.section_id = next_section.previous_section_id
		WHERE a.section_id = ?`
	)
		.bind(sectionId)
		.first();
	return row as any;
}

type Section = {
	filename: string;
	nest_filename?: string | null;
	nest_display_name?: string | null;
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
	display_name: string;
	photoURL: string | null;
	name: string | null;
};

type SpeechIndexRow = {
	filename: string;
	display_name: string;
	isNested: number | boolean;
	nest_filenames?: string | null;
	nest_display_names?: string | null;
};

type SpeechListItem = {
	filename: string;
	display_name: string;
};

type SpeakerListItem = {
	id: number;
	route_pathname: string;
	name: string;
	photoURL: string | null;
};

async function loadSpeechMeta(c: any, filename: string): Promise<SpeechIndexRow | null> {
	const result = await c.env.DB.prepare(
		`SELECT filename, display_name, isNested, nest_filenames, nest_display_names
		 FROM speech_index WHERE filename = ?`
	)
		.bind(filename)
		.first();

	return result as SpeechIndexRow ?? null;
}

type AlternateInfo = { url: string; label: string; displayName: string; hreflang: string };

async function loadAlternateInfo(c: any, filename: string): Promise<AlternateInfo | null> {
	try {
		const row = await c.env.DB.prepare(
			`SELECT si.alternate_filename, alt.display_name AS alternate_display_name
			 FROM speech_index si
			 LEFT JOIN speech_index alt ON si.alternate_filename = alt.filename
			 WHERE si.filename = ? AND si.alternate_filename IS NOT NULL`
		)
			.bind(filename)
			.first();
		if (!row?.alternate_filename) return null;
		const displayName = row.alternate_display_name || row.alternate_filename;
		const isCjk = /[\u4e00-\u9fff]/.test(displayName);
		return {
			url: `/${encodeURIComponent(row.alternate_filename)}`,
			label: isCjk ? '華文' : 'English',
			displayName,
			hreflang: isCjk ? 'zh-Hant' : 'en'
		};
	} catch {
		return null;
	}
}

async function loadSpeeches(c: any): Promise<SpeechListItem[]> {
	const result = await c.env.DB.prepare(
		'SELECT filename, display_name FROM speech_index ORDER BY id ASC'
	).all();

	if (!result.success) {
		throw new Error('Database query failed');
	}

	return result.results.map((row: any) => ({
		filename: row.filename,
		display_name: row.display_name
	}));
}

async function loadSpeakers(c: any): Promise<SpeakerListItem[]> {
	const result = await c.env.DB.prepare(
		'SELECT id, route_pathname, name, photoURL FROM speakers ORDER BY id ASC'
	).all();

	if (!result.success) {
		throw new Error('Database query failed');
	}

	return result.results.map((row: any) => ({
		id: row.id,
		route_pathname: row.route_pathname,
		name: row.name,
		photoURL: row.photoURL ?? null
	}));
}


// /、/speeches、/speakers 由 SSR 路由提供，其餘靜態資源由 staticFirstMiddleware 嘗試從 ASSETS 提供

// API CORS preflight
app.options('/api/*', (c) => handleOptions(c));

// D1 APIs
app.get('/api/speech_index.json', (c) => speechIndex(c));
app.get('/api/speakers_index.json', (c) => speakersIndex(c));
app.get('/api/speaker_detail/:route_pathname_with_json', (c) => speakerDetail(c));
app.get('/api/speech/*', (c) => speechContent(c));
app.get('/api/section/:section_id', (c) => sectionDetail(c));
app.on(['GET', 'HEAD'], '/api/an/:path{[^/]+\\.an}', (c) => speechAn(c));
app.get('/api/md/:path{[^/]+\\.md}', async (c) => {
	const pathParam = c.req.param('path');
	const key = pathParam ? decodeURIComponent(pathParam) : null;
	if (!key) return c.text('Not found', 404);
	return serveMdByKey(c, key);
});
app.post('/api/upload_markdown', (c) => uploadMarkdown(c));
app.patch('/api/upload_markdown', (c) => uploadMarkdown(c));
app.delete('/api/upload_markdown', (c) => uploadMarkdown(c));
app.on(['GET', 'HEAD'], '/rss.xml', (c) => rssFeed(c));
app.on(['GET', 'HEAD'], '/feed.xml', (c) => rssFeed(c));

app.post('/api/purge_cache', async (c) => {
	const authHeader = c.req.header('Authorization');
	if (!authHeader?.startsWith('Bearer ')) return c.text('Forbidden', 403);
	const token = authHeader.slice(7);
	if (!token || (token !== c.env.AUDREYT_TRANSCRIPT_TOKEN && token !== c.env.BESTIAN_TRANSCRIPT_TOKEN)) {
		return c.text('Forbidden', 403);
	}

	const bucket = c.env.SPEECH_CACHE;
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const list = await bucket.list({ cursor, limit: 500 });
		const keys = list.objects.map((o: { key: string }) => o.key);
		if (keys.length > 0) {
			await Promise.all(keys.map((key) => deleteEdgeCache(key)));
			await bucket.delete(keys);
			deleted += keys.length;
		}
		cursor = list.truncated ? list.cursor : undefined;
	} while (cursor);
	return c.json({ deleted });
});


async function renderHomePage(c: any) {
	const styles = [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForHome();
	const html = await renderHtml(HomeView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: {},
		scripts: [PAGEFIND_SCRIPT, STATS_SCRIPT].join('\n')
	});

	return withCacheHeaders(c.html(html));
}

async function renderSpeechesPage(c: any) {
	const cacheKey = buildCacheKey(c.req.url);
	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) {
		await writeEdgeCache(cacheKey, r2Cached.clone(), DEFAULT_HTML_CACHE_CONTROL);
		return r2Cached;
	}

	const edgeCached = await readEdgeCache(cacheKey);
	if (edgeCached) return edgeCached;

	let speeches: SpeechListItem[];
	try {
		speeches = await loadSpeeches(c);
	} catch (err) {
		console.error('[speeches SSR] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	const styles = [SpeechesViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSpeeches();
	const html = await renderHtml(SpeechesView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { speeches },
		scripts: PAGEFIND_SCRIPT
	});

	let response = c.html(html);
	response = withCacheHeaders(response);
	if (response.ok && response.status < 400) {
		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());
		await writeEdgeCache(cacheKey, response.clone(), DEFAULT_HTML_CACHE_CONTROL);
	}
	return response;
}

async function renderSpeakersPage(c: any) {
	const cacheKey = buildCacheKey(c.req.url);
	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) {
		await writeEdgeCache(cacheKey, r2Cached.clone(), DEFAULT_HTML_CACHE_CONTROL);
		return r2Cached;
	}

	const edgeCached = await readEdgeCache(cacheKey);
	if (edgeCached) return edgeCached;

	let speakers: SpeakerListItem[];
	try {
		speakers = await loadSpeakers(c);
	} catch (err) {
		console.error('[speakers SSR] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	const styles = [SpeakersViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSpeakers();
	const html = await renderHtml(SpeakersView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { speakers }
	});

	let response = c.html(html);
	response = withCacheHeaders(response);
	if (response.ok && response.status < 400) {
		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());
		await writeEdgeCache(cacheKey, response.clone(), DEFAULT_HTML_CACHE_CONTROL);
	}
	return response;
}

app.get('/speeches', (c) => renderSpeechesPage(c));
app.get('/speeches/', (c) => renderSpeechesPage(c));
app.get('/speakers', (c) => renderSpeakersPage(c));
app.get('/speakers/', (c) => renderSpeakersPage(c));
app.get('/', (c) => renderHomePage(c));
app.get('/index.html', (c) => renderHomePage(c));

// /speech/:section_id -> .md/.an 轉專用處理，否則為動態段落頁
app.on(['GET', 'HEAD'], '/speech/:section_id', async (c) => {
	const param = c.req.param('section_id');
	if (param.endsWith('.md')) {
		console.log('serving md by key', param);
		return serveMdByKey(c, param);
	}
	if (param.endsWith('.an')) {
		console.log('serving an by key', param);
		return serveAnByKey(c, param);
	}
	// 以下為動態段落頁
	const sectionId = Number(param);
	if (!Number.isInteger(sectionId)) {
		return c.text('Bad Request', 400);
	}

	let section: any;
	try {
		section = await loadSection(c, sectionId);
	} catch (err) {
		console.error('[speech page] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	if (!section) {
		return c.text('Not Found', 404);
	}

	const sectionHtml = parseContent(section.section_content ?? '');
	const plain = toPlainText(sectionHtml);
	const snippet = plain ? `${plain.slice(0, 80)}${plain.length > 80 ? '...' : ''}` : section.display_name ?? '';
	const titleText = snippet ? `“${snippet}”` : 'View Section';
	const styles = [SingleParagraphViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const navigationScript = `<script>(function(){var box=document.getElementById('keyboard-shortcuts');if(!box)return;var prev=box.getAttribute('data-prev-url')||'';var next=box.getAttribute('data-next-url')||'';function editable(el){if(!el)return false;var tag=el.tagName?el.tagName.toLowerCase():'';return tag==='input'||tag==='textarea'||tag==='select'||tag==='option'||el.isContentEditable;}document.addEventListener('keydown',function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;if(editable(document.activeElement))return;if(e.key==='j'){if(prev){window.location.href=prev;}}else if(e.key==='k'){if(next){window.location.href=next;}}});})();</script>`;

	const head = headForSpeechContent(titleText, sectionHtml);
	const html = await renderHtml(SingleParagraphView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { section },
		scripts: [navigationScript, PAGEFIND_SCRIPT].filter(Boolean).join('\n')
	});

	return c.html(html);
});

// SSR 講者頁
app.get('/speaker/:route_pathname', async (c) => {
	const cacheKey = buildCacheKey(c.req.url);
	const edgeCached = await readEdgeCache(cacheKey);
	if (edgeCached) return edgeCached;

	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) {
		console.log('writing to edge cache', cacheKey);
		await writeEdgeCache(cacheKey, r2Cached.clone(), DEFAULT_HTML_CACHE_CONTROL);
		return r2Cached;
	}

	const routePathname = encodeURIComponent(c.req.param('route_pathname'));
	console.log(routePathname);
	if (!routePathname) {
		return c.text('Bad Request', 400);
	}

	let speaker: any;
	let sections: Section[];
	try {
		// 取得講者基本資料
		const speakerRow = await c.env.DB.prepare('SELECT * FROM speakers_view WHERE route_pathname = ?')
			.bind(routePathname)
			.first();

		if (!speakerRow) {
			return c.text('Not Found', 404);
		}

		const pageSize = 50;
		const urlObj = new URL(c.req.url);
		const pageParam = urlObj.searchParams.get('page') ?? '';
		const pageNumber = Number(pageParam);
		const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.floor(pageNumber) : 1;
		const offset = (page - 1) * pageSize;

		// 取得講者的所有段落（分頁）
		const sectionsResult = await c.env.DB.prepare(
			`SELECT
				sc.filename,
				sc.section_id,
				sc.previous_section_id,
				sc.next_section_id,
				sc.section_speaker,
				sc.section_content,
				si.display_name
			FROM speech_content sc
			LEFT JOIN speech_index si ON sc.filename = si.filename
			WHERE sc.section_speaker = ?
			ORDER BY sc.filename DESC, sc.section_id ASC
			LIMIT ? OFFSET ?`
		)
			.bind(routePathname, pageSize, offset)
			.all();

		if (!sectionsResult.success) {
			throw new Error('Database query failed');
		}

		sections = normalizeSections(
			sectionsResult.results.map((row: any) => ({
				filename: row.filename,
				display_name: row.display_name,
				section_id: row.section_id,
				previous_section_id: row.previous_section_id,
				next_section_id: row.next_section_id,
				section_speaker: row.section_speaker,
				section_content: row.section_content,
				photoURL: null,
				name: null
			})),
			false // 分頁結果，不做重新串接
		);

		const longestSection = speakerRow.longest_section_id
			? {
					section_id: speakerRow.longest_section_id,
					section_content: speakerRow.longest_section_content || '',
					section_filename: speakerRow.longest_section_filename || '',
					section_display_name: speakerRow.longest_section_displayname || ''
			  }
			: null;

		const totalSections =
			(typeof speakerRow.sections_count === 'number' ? speakerRow.sections_count : null) ?? sections.length;
		const totalPages = Math.max(1, Math.ceil(totalSections / pageSize));
		const paginationPages = buildPaginationPages(page, totalPages);

		speaker = {
			id: speakerRow.id,
			route_pathname: speakerRow.route_pathname,
			name: speakerRow.name,
			photoURL: speakerRow.photoURL,
			appearances_count: speakerRow.appearances_count ?? 0,
			sections_count: totalSections,
			page,
			page_size: pageSize,
			total_pages: totalPages,
			pagination_pages: paginationPages,
			sections,
			longest_section: longestSection
		};
	} catch (err) {
		console.error('[speaker SSR] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	const styles = [SingleSpeakerViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSpeaker(speaker.route_pathname);

	const html = await renderHtml(SingleSpeakerView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { initialSpeaker: speaker, routePathname: speaker.route_pathname },
		scripts: ['<script src="/static/speeches/js/masonry.pkgd.min.js"></script>', PAGEFIND_SCRIPT].join('\n')
	});

	let response = c.html(html);
	response = withCacheHeaders(response);

	if (response.ok && response.status < 400) {
		console.log('writing to R2 cache', cacheKey);
		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());
		await writeEdgeCache(cacheKey, response.clone(), DEFAULT_HTML_CACHE_CONTROL);
	}

	return response;
});


// favicon、robots、/media/*、/static/* 由 staticFirstMiddleware 從 ASSETS 提供

const excludedPaths = [
	'api',
	'speeches',
	'speakers',
	'speaker',
	'speech',
	'rss.xml',
	'feed.xml',
	'favicon.ico',
	'robots.txt',
	'static',
	'index.html'
];

function isExcludedPath(segment: string) {
	return excludedPaths.includes(segment.toLowerCase());
}

// SSR 巢狀演講內容頁（巢狀子項）
app.get('/:filename/:nest_filename', async (c) => {
	const cacheKey = buildCacheKey(c.req.url);
	const edgeCached = await readEdgeCache(cacheKey);
	if (edgeCached) return edgeCached;

	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) {
		await writeEdgeCache(cacheKey, r2Cached.clone(), DEFAULT_HTML_CACHE_CONTROL);
		return r2Cached;
	}

	const encodedFilename = c.req.param('filename');
	const encodedNestFilename = c.req.param('nest_filename');

	if (!encodedFilename || !encodedNestFilename || isExcludedPath(encodedFilename)) {
		return c.text('Not Found', 404);
	}

	let filename: string;
	let nestFilename: string;
	try {
		filename = decodeURIComponent(encodedFilename);
		nestFilename = decodeURIComponent(encodedNestFilename);
	} catch {
		return c.text('Not Found', 404);
	}

	let speechMeta: SpeechIndexRow | null;
	try {
		speechMeta = await loadSpeechMeta(c, filename);
	} catch (err) {
		console.error('[nested speech meta] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	if (!speechMeta || !speechMeta.isNested) {
		return c.text('Not Found', 404);
	}

	let sections: Section[];
	try {
		const result = await c.env.DB.prepare(
			`SELECT
				sc.filename,
				sc.nest_filename,
				sc.nest_display_name,
				sc.section_id,
				sc.previous_section_id,
				sc.next_section_id,
				sc.section_speaker,
				sc.section_content,
				si.display_name,
				sp.photoURL,
				sp.name
			FROM speech_content sc
			LEFT JOIN speech_index si ON sc.filename = si.filename
			LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
			WHERE sc.filename = ? AND sc.nest_filename = ?
			ORDER BY sc.section_id ASC`
		)
			.bind(filename, nestFilename)
			.all();

		if (!result.success) {
			throw new Error('Database query failed');
		}

		const rawSections = result.results.map((row: any) => ({
			filename: row.filename,
			nest_filename: row.nest_filename ?? null,
			nest_display_name: row.nest_display_name ?? row.nest_filename ?? null,
			section_id: row.section_id,
			previous_section_id: row.previous_section_id,
			next_section_id: row.next_section_id,
			section_speaker: row.section_speaker,
			section_content: row.section_content,
			display_name: row.display_name,
			photoURL: row.photoURL,
			name: row.name
		}));

		if (rawSections.length === 0) {
			return c.text('Not Found', 404);
		}

		sections = normalizeSections(rawSections);
	} catch (err) {
		console.error('[nested speech detail] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	const nestDisplayName = sections[0]?.nest_display_name ?? nestFilename;
	const speechDisplayName = speechMeta.display_name ?? filename;
	const nestFilenames = parseToArray(speechMeta.nest_filenames);
	const nestDisplayNames = parseToArray(speechMeta.nest_display_names);
	const siblings = nestFilenames.map((nest, idx) => ({
		nest_filename: nest,
		nest_display_name: nestDisplayNames[idx] ?? nest
	}));
	const alternate = await loadAlternateInfo(c, filename);
	const styles = [SingleNestedSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForNestedSpeechDetail(nestDisplayName);
	if (alternate) {
		head.links = [{ rel: 'alternate', href: `https://sayit.archive.tw${alternate.url}`, hreflang: alternate.hreflang }];
	}

	const hasSiblingNav = siblings.length > 0;
	const navigationScript = hasSiblingNav
		? `<script>(function(){var prev=document.querySelector('[data-prev-btn]');var next=document.querySelector('[data-next-btn]');function isEditable(el){if(!el)return false;var tag=el.tagName?el.tagName.toLowerCase():'';return tag==='input'||tag==='textarea'||el.isContentEditable;}document.addEventListener('keydown',function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;if(isEditable(document.activeElement))return;if(e.key==='j'&&prev&&prev.getAttribute('href')){window.location.href=prev.getAttribute('href');}if(e.key==='k'&&next&&next.getAttribute('href')){window.location.href=next.getAttribute('href');}});})();</script>`
		: undefined;

	const html = await renderHtml(SingleNestedSpeechView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: {
			sections,
			speechName: filename,
			nestFilename,
			displayName: nestDisplayName,
			speechDisplayName,
			siblings,
			alternateUrl: alternate?.url ?? null,
			alternateLabel: alternate?.label ?? null
		},
		scripts: [navigationScript, PAGEFIND_SCRIPT].filter(Boolean).join('\n')
	});

	let response = c.html(html);
	response = withCacheHeaders(response);

	if (response.ok && response.status < 400) {
		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());
		await writeEdgeCache(cacheKey, response.clone(), DEFAULT_HTML_CACHE_CONTROL);
	}

	return response;
});

// .md 檔案
app.on(['GET', 'HEAD'], '/:path{[^/]+\\.md}', (c) => serveMdByKey(c, c.req.param('path')));

// .an 檔案
app.on(['GET', 'HEAD'], '/:path{[^/]+\\.an}', (c) => serveAnByKey(c, c.req.param('path')));

// SSR 演講頁（單一演講或巢狀清單，直接用 filename 作為路徑；需置於最後的 catch-all 之前）
app.get('/:filename', async (c) => {
	const cacheKey = buildCacheKey(c.req.url);
	const edgeCached = await readEdgeCache(cacheKey);
	if (edgeCached) {
		console.log('[edge cache] hit', cacheKey);
		return edgeCached;
	}

	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) {
		console.log('[r2 cache] hit', cacheKey);
		await writeEdgeCache(cacheKey, r2Cached.clone(), DEFAULT_HTML_CACHE_CONTROL);
		return r2Cached;
	}

	console.log('SSR Single Speech filename', c.req.param('filename'));
	const encodedFilename = c.req.param('filename');
	if (!encodedFilename) {
		return c.text('Not Found', 404);
	}

	if (isExcludedPath(encodedFilename)) {
		return c.text('Not Found', 404);
	}

	// 純數字留給 /speech/:section_id
	if (/^\d+$/.test(encodedFilename)) {
		return c.text('Not Found', 404);
	}

	let filename: string;
	try {
		filename = decodeURIComponent(encodedFilename);
	} catch {
		return c.text('Not Found', 404);
	}

	let speechMeta: SpeechIndexRow | null;
	try {
		speechMeta = await loadSpeechMeta(c, filename);
	} catch (err) {
		console.error('[speech meta] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	if (!speechMeta) {
		return c.text('Not Found', 404);
	}

	if (speechMeta.isNested) {
		let nests: Array<{ nest_filename: string; nest_display_name: string; section_count: number; preview?: string }> =
			[];

		try {
			const result = await c.env.DB.prepare(
				`SELECT
					nest_filename,
					nest_display_name,
					section_id,
					section_content
				FROM speech_content
				WHERE filename = ?
				ORDER BY section_id ASC`
			)
				.bind(filename)
				.all();

			if (!result.success) {
				throw new Error('Database query failed');
			}

			const map = new Map<
				string,
				{ nest_filename: string; nest_display_name: string; section_count: number; preview?: string }
			>();

			for (const row of result.results as any[]) {
				const nestKey = row.nest_filename;
				if (!nestKey) continue;

				const existing = map.get(nestKey) ?? {
					nest_filename: nestKey,
					nest_display_name: row.nest_display_name ?? nestKey,
					section_count: 0,
					preview: undefined
				};

				const currentCount = existing.section_count + 1;
				let preview = existing.preview;
				if (!preview) {
					const parsedContent = parseContent(row.section_content ?? '');
					const plain = toPlainText(parsedContent);
					preview = plain ? `${plain.slice(0, 80)}${plain.length > 80 ? '...' : ''}` : undefined;
				}

				map.set(nestKey, {
					...existing,
					section_count: currentCount,
					preview
				});
			}

			nests = Array.from(map.values());
		} catch (err) {
			console.error('[nested speech list] DB error', err);
			return c.text('Internal Server Error', 500);
		}

		if (nests.length === 0) {
			return c.text('Not Found', 404);
		}

		const alternate = await loadAlternateInfo(c, filename);
		const styles = [NestedSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
		const head = headForNestedSpeech(speechMeta.display_name ?? filename);
		if (alternate) {
			head.links = [{ rel: 'alternate', href: `https://sayit.archive.tw${alternate.url}`, hreflang: alternate.hreflang }];
		}

		const html = await renderHtml(NestedSpeechView, {
			head,
			styles,
			components: { Navbar, Footer },
			props: {
				nests,
				speechName: filename,
				displayName: speechMeta.display_name ?? filename,
				alternateUrl: alternate?.url ?? null,
				alternateLabel: alternate?.label ?? null
			},
			scripts: PAGEFIND_SCRIPT
		});

		return c.html(html);
	}

	let sections: Section[];
	try {
		// 直接查 speech_content + JOIN，避免 sections view 在大資料量時效能問題
		const result = await c.env.DB.prepare(
			`SELECT
				sc.filename,
				sc.section_id,
				sc.previous_section_id,
				sc.next_section_id,
				sc.section_speaker,
				sc.section_content,
				si.display_name,
				sp.photoURL,
				sp.name
			FROM speech_content sc
			LEFT JOIN speech_index si ON sc.filename = si.filename
			LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
			WHERE sc.filename = ?
			ORDER BY sc.section_id ASC`
		)
			.bind(filename)
			.all();

		if (!result.success) {
			throw new Error('Database query failed');
		}

		const rawSections = result.results.map((row: any) => ({
			filename: row.filename,
			section_id: row.section_id,
			previous_section_id: row.previous_section_id,
			next_section_id: row.next_section_id,
			section_speaker: row.section_speaker,
			section_content: row.section_content,
			display_name: row.display_name,
			photoURL: row.photoURL ?? null,
			name: row.name ?? null
		}));

		if (rawSections.length === 0) {
			return c.text('Not Found', 404);
		}

		sections = normalizeSections(rawSections);
	} catch (err) {
		console.error('[speech SSR] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	const displayName = sections[0]?.display_name ?? speechMeta.display_name ?? filename;
	const alternate = await loadAlternateInfo(c, filename);
	const styles = [SingleSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSingleSpeech(displayName);
	if (alternate) {
		head.links = [{ rel: 'alternate', href: `https://sayit.archive.tw${alternate.url}`, hreflang: alternate.hreflang }];
	}

	const html = await renderHtml(SingleSpeechView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { sections, speechName: filename, displayName, alternateUrl: alternate?.url ?? null, alternateLabel: alternate?.label ?? null },
		scripts: PAGEFIND_SCRIPT
	});

	let response = c.html(html);
	response = withCacheHeaders(response);

	if (response.ok && response.status < 400) {
		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());
		await writeEdgeCache(cacheKey, response.clone(), DEFAULT_HTML_CACHE_CONTROL);
	}

	return response;
});


// 其餘請求：靜態已由 middleware 嘗試過，未匹配則 404
app.get('*', (c) => c.text('Not Found', 404));

export default app;
