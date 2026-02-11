import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { speechIndex } from './api/speech_index';
import { handleOptions } from './api/cors';
import { readEdgeCache, readR2Cache, writeEdgeCache, writeR2Cache } from './api/cache';
import { speakersIndex } from './api/speakers_index';
import { speakerDetail } from './api/speaker_detail';
import { speechContent } from './api/speech';
import { sectionDetail } from './api/section';
import { speechAn, serveAnByKey } from './api/an';
import { serveMdByKey } from './api/md';
import { runSearchHomepage, searchHomepage } from './api/search_homepage';
import { uploadMarkdown } from './api/upload_markdown';
import type { ApiEnv } from './api/types';
import SingleParagraphView, { styles as SingleParagraphViewStyles } from './.generated/views/SingleParagraphView';
import SingleSpeechView, { styles as SingleSpeechViewStyles } from './.generated/views/SingleSpeechView';
import NestedSpeechView, { styles as NestedSpeechViewStyles } from './.generated/views/NestedSpeechView';
import SingleNestedSpeechView, { styles as SingleNestedSpeechViewStyles } from './.generated/views/SingleNestedSpeechView';
import SingleSpeakerView, { styles as SingleSpeakerViewStyles } from './.generated/views/SingleSpeakerView';
import SearchResultView, { styles as SearchResultViewStyles } from './.generated/views/SearchResultView';
import Navbar, { styles as NavbarStyles } from './.generated/components/Navbar';
import Footer, { styles as FooterStyles } from './.generated/components/Footer';
import { renderHtml } from './ssr/render';
import {
	headForSpeechContent,
	headForSingleSpeech,
	headForSpeaker,
	headForNestedSpeech,
	headForNestedSpeechDetail,
	headForSearch
} from './ssr/heads';
import { buildPaginationPages } from './utils/pagination';
import { normalizeSections } from './utils/sectionUtils';

type WorkerEnv = ApiEnv['Bindings'];

const app = new Hono<{ Bindings: WorkerEnv }>();

// 靜態檔優先：先嘗試 ASSETS（Cloudflare CI 建置），找不到再走 API/SSR
app.use('*', staticFirstMiddleware);

const EDGE_TTL_SECONDS = 60;
const DEFAULT_HTML_CACHE_CONTROL = `public, max-age=${EDGE_TTL_SECONDS}, s-maxage=${EDGE_TTL_SECONDS}`;

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

async function loadSpeechMeta(c: any, filename: string): Promise<SpeechIndexRow | null> {
	const result = await c.env.DB.prepare(
		`SELECT filename, display_name, isNested, nest_filenames, nest_display_names
		 FROM speech_index WHERE filename = ?`
	)
		.bind(filename)
		.first();

	return result as SpeechIndexRow ?? null;
}


// 根與靜態列表頁由 staticFirstMiddleware 從 ASSETS 提供（/ → index.html 等）

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
app.get('/api/search_homepage.json', (c) => searchHomepage(c));
app.post('/api/upload_markdown', (c) => uploadMarkdown(c));
app.patch('/api/upload_markdown', (c) => uploadMarkdown(c));
app.delete('/api/upload_markdown', (c) => uploadMarkdown(c));

// SSR 搜尋結果頁
async function renderSearchPage(c: any) {
	const url = new URL(c.req.url);
	const query = url.searchParams.get('q') ?? '';
	const pageParam = url.searchParams.get('page');
	const pageNumber = Number(pageParam);
	const page = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1;

	// 解析講者 ID 參數 (p)
	const speakerIdParam = url.searchParams.get('p');
	const speakerId = speakerIdParam && Number.isFinite(Number(speakerIdParam)) && Number(speakerIdParam) > 0
		? Math.floor(Number(speakerIdParam))
		: undefined;

	// 如果有講者 ID，查詢講者名稱
	let filteredSpeakerName: string | null = null;
	if (speakerId) {
		try {
			const speakerRow = await c.env.DB.prepare('SELECT name FROM speakers WHERE id = ?')
				.bind(speakerId)
				.first();
			if (speakerRow && (speakerRow as any).name) {
				filteredSpeakerName = (speakerRow as any).name;
			}
		} catch (err) {
			console.error('[search SSR] failed to get speaker name', err);
		}
	}

	let result: Awaited<ReturnType<typeof runSearchHomepage>>;
	try {
		result = await runSearchHomepage(c.env, query, { page, speakerId });
	} catch (err) {
		console.error('[search SSR] query failed', err);
		return c.text('Internal Server Error', 500);
	}

	const styles = [SearchResultViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSearch(result.query);
	const scripts = [
		'<script type="text/javascript" src="/static/speeches/js/foundation/foundation.js" charset="utf-8"></script>',
		'<script type="text/javascript" src="/static/speeches/js/foundation/foundation.dropdown.js" charset="utf-8"></script>',
		'<script type="text/javascript" src="/static/speeches/js/speeches.js" charset="utf-8"></script>'
	].join('\n');

	const html = await renderHtml(SearchResultView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: {
			query: result.query,
			speakers: result.speakers,
			sections: result.sections,
			page: result.page,
			page_size: result.page_size,
			total_pages: result.total_pages,
			total_sections: result.total_sections,
			pagination_pages: result.pagination_pages,
			filteredSpeakerId: speakerId,
			filteredSpeakerName: filteredSpeakerName
		},
		scripts
	});

	return withCacheHeaders(c.html(html));
}

app.get('/search', (c) => renderSearchPage(c));
app.get('/search/', (c) => renderSearchPage(c));

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
		scripts: navigationScript
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
		scripts: '<script src="/static/speeches/js/masonry.pkgd.min.js"></script>'
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
	const styles = [SingleNestedSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForNestedSpeechDetail(nestDisplayName);

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
			siblings
		},
		scripts: navigationScript
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

		const styles = [NestedSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
		const head = headForNestedSpeech(speechMeta.display_name ?? filename);

		const html = await renderHtml(NestedSpeechView, {
			head,
			styles,
			components: { Navbar, Footer },
			props: {
				nests,
				speechName: filename,
				displayName: speechMeta.display_name ?? filename
			}
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
	const styles = [SingleSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSingleSpeech(displayName);

	const html = await renderHtml(SingleSpeechView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { sections, speechName: filename, displayName }
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
