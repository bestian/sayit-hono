import type { Context } from 'hono';
import type { AppContext, AlternateInfo, Section, SpeechIndexRow, WorkerEnv } from './shared';
import { hasTwitterEmbed, isExcludedPath, PAGEFIND_SCRIPT, TWITTER_WIDGETS_SCRIPT } from './shared';
import { DEFAULT_HTML_CACHE_CONTROL, buildR2HtmlKey, readR2Cache, tags, withCacheHeaders, writeR2Cache } from '../../api/cache';
import { renderHtml } from '../render';
import { headForNestedSpeech, headForNestedSpeechDetail, headForSingleSpeech, headForSpeechContent } from '../heads';
import { normalizeSections } from '../../utils/sectionUtils';
import { parseContent, toPlainText } from '../../utils/textUtils';
import { serveAnByKey } from '../../api/an';
import { serveMdByKey } from '../../api/md';
import Footer, { styles as FooterStyles } from '../../components/Footer.vue';
import Navbar, { styles as NavbarStyles } from '../../components/Navbar.vue';
import NestedSpeechView, { styles as NestedSpeechViewStyles } from '../../views/NestedSpeechView.vue';
import SingleNestedSpeechView, { styles as SingleNestedSpeechViewStyles } from '../../views/SingleNestedSpeechView.vue';
import SingleParagraphView, { styles as SingleParagraphViewStyles } from '../../views/SingleParagraphView.vue';
import SingleSpeechView, { styles as SingleSpeechViewStyles } from '../../views/SingleSpeechView.vue';

// Route-literal Context types: Hono's own routing guarantees a required named segment is
// always defined once matched, so `c.req.param(name)` narrows to `string` (never `undefined`)
// for these exact patterns — matching how each function is actually registered in src/index.ts.
type SectionPageContext = Context<{ Bindings: WorkerEnv }, '/speech/:section_id'>;
type NestedSpeechPageContext = Context<{ Bindings: WorkerEnv }, '/:filename/:nest_filename'>;
type SpeechPageContext = Context<{ Bindings: WorkerEnv }, '/:filename'>;

function parseToArray(raw?: string | null): string[] {
	if (!raw) return [];
	return parseContent(raw)
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);
}

async function loadSection(c: AppContext, sectionId: number): Promise<Section | null> {
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
		WHERE a.section_id = ?`,
	)
		.bind(sectionId)
		.first();
	return row as Section | null;
}

async function loadSpeechMeta(c: AppContext, filename: string): Promise<SpeechIndexRow | null> {
	const result = await c.env.DB.prepare(
		`SELECT filename, display_name, isNested, nest_filenames, nest_display_names
		 FROM speech_index WHERE filename = ?`,
	)
		.bind(filename)
		.first();

	return (result as SpeechIndexRow) ?? null;
}

async function loadSpeechRedirect(c: AppContext, oldFilename: string): Promise<string | null> {
	try {
		const row = await c.env.DB.prepare('SELECT new_filename FROM speech_redirects WHERE old_filename = ?').bind(oldFilename).first();
		const target = (row as { new_filename?: string } | null)?.new_filename;
		return typeof target === 'string' && target.length > 0 ? target : null;
	} catch (err) {
		console.error('[speech redirect] DB error', err);
		return null;
	}
}

function buildSpeechRedirectResponse(c: AppContext, location: string): Response {
	const response = c.redirect(location, 301);
	response.headers.set('Cache-Control', 'public, max-age=86400');
	return response;
}

async function loadAlternateInfo(c: AppContext, filename: string): Promise<AlternateInfo | null> {
	try {
		const row = (await c.env.DB.prepare(
			`SELECT si.alternate_filename, alt.display_name AS alternate_display_name
			 FROM speech_index si
			 LEFT JOIN speech_index alt ON si.alternate_filename = alt.filename
			 WHERE si.filename = ? AND si.alternate_filename IS NOT NULL`,
		)
			.bind(filename)
			.first()) as { alternate_filename?: string; alternate_display_name?: string } | null;
		if (!row?.alternate_filename) return null;
		const displayName: string = row.alternate_display_name || row.alternate_filename;
		const isCjk = /[\u4e00-\u9fff]/.test(displayName);
		return {
			url: `/${encodeURIComponent(row.alternate_filename)}`,
			label: isCjk ? '華文' : 'English',
			displayName,
			hreflang: isCjk ? 'zh-Hant' : 'en',
		};
	} catch {
		return null;
	}
}

// /speech/:section_id -> .md/.an 轉專用處理，否則為動態段落頁
export async function renderSectionPage(c: SectionPageContext): Promise<Response> {
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

	const cacheKey = buildR2HtmlKey(c.req.url, { includeSearch: false });
	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	// Cache-Tag restored from R2 customMetadata when present (writeR2Cache stores it).
	if (r2Cached) {
		const existingTag = r2Cached.headers.get('Cache-Tag');
		return withCacheHeaders(r2Cached, DEFAULT_HTML_CACHE_CONTROL, existingTag ? existingTag.split(',') : undefined);
	}

	let section: Section | null;
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
	const snippet = plain ? `${plain.slice(0, 80)}${plain.length > 80 ? '...' : ''}` : (section.display_name ?? '');
	const titleText = snippet ? `”${snippet}”` : 'View Section';
	const styles = [SingleParagraphViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const navigationScript = `<script>(function(){var box=document.getElementById('keyboard-shortcuts');if(!box)return;var prev=box.getAttribute('data-prev-url')||'';var next=box.getAttribute('data-next-url')||'';function editable(el){if(!el)return false;var tag=el.tagName?el.tagName.toLowerCase():'';return tag==='input'||tag==='textarea'||tag==='select'||tag==='option'||el.isContentEditable;}document.addEventListener('keydown',function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;if(editable(document.activeElement))return;if(e.key==='j'){if(next){window.location.href=next;}}else if(e.key==='k'){if(prev){window.location.href=prev;}}});})();</script>`;

	const head = headForSpeechContent(titleText, sectionId, sectionHtml);
	const twitterScript = hasTwitterEmbed([section.section_content]) ? TWITTER_WIDGETS_SCRIPT : '';
	const html = await renderHtml(SingleParagraphView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { section },
		scripts: [navigationScript, PAGEFIND_SCRIPT, twitterScript].filter(Boolean).join('\n'),
	});

	const response = withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [tags.speech(section.filename)]);
	await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());
	return response;
}

// SSR 巢狀演講內容頁（巢狀子項）
export async function renderNestedSpeechPage(c: NestedSpeechPageContext): Promise<Response> {
	const cacheKey = buildR2HtmlKey(c.req.url, { includeSearch: false });
	const encodedFilename = c.req.param('filename');
	const encodedNestFilename = c.req.param('nest_filename');

	if (isExcludedPath(encodedFilename)) {
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

	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) return withCacheHeaders(r2Cached, DEFAULT_HTML_CACHE_CONTROL, [tags.speech(filename)]);

	let speechMeta: SpeechIndexRow | null;
	try {
		speechMeta = await loadSpeechMeta(c, filename);
	} catch (err) {
		console.error('[nested speech meta] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	if (!speechMeta) {
		const redirectTo = await loadSpeechRedirect(c, filename);
		if (redirectTo) {
			return buildSpeechRedirectResponse(c, `/${encodeURIComponent(redirectTo)}/${encodeURIComponent(nestFilename)}`);
		}
		return c.text('Not Found', 404);
	}

	if (!speechMeta.isNested) {
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
			ORDER BY sc.section_id ASC`,
		)
			.bind(filename, nestFilename)
			.all();

		if (!result.success) {
			throw new Error('Database query failed');
		}

		const rawSections = result.results.map((row: Record<string, unknown>) => ({
			filename: row.filename as string,
			nest_filename: (row.nest_filename as string | null) ?? null,
			nest_display_name: (row.nest_display_name as string | null) ?? (row.nest_filename as string | null) ?? null,
			section_id: row.section_id as number,
			previous_section_id: row.previous_section_id as number | null,
			next_section_id: row.next_section_id as number | null,
			section_speaker: row.section_speaker as string | null,
			section_content: row.section_content as string,
			display_name: row.display_name as string,
			photoURL: row.photoURL as string | null,
			name: row.name as string | null,
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
		nest_display_name: nestDisplayNames[idx] ?? nest,
	}));
	const alternate = await loadAlternateInfo(c, filename);
	const styles = [SingleNestedSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForNestedSpeechDetail(nestDisplayName, filename);
	if (alternate) {
		head.links = [{ rel: 'alternate', href: `https://archive.tw${alternate.url}`, hreflang: alternate.hreflang }];
	}

	const hasSiblingNav = siblings.length > 0;
	const navigationScript = hasSiblingNav
		? `<script>(function(){var prev=document.querySelector('[data-prev-btn]');var next=document.querySelector('[data-next-btn]');function isEditable(el){if(!el)return false;var tag=el.tagName?el.tagName.toLowerCase():'';return tag==='input'||tag==='textarea'||el.isContentEditable;}document.addEventListener('keydown',function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;if(isEditable(document.activeElement))return;if(e.key==='j'&&next&&next.getAttribute('href')){window.location.href=next.getAttribute('href');}if(e.key==='k'&&prev&&prev.getAttribute('href')){window.location.href=prev.getAttribute('href');}});})();</script>`
		: undefined;

	const twitterScript = hasTwitterEmbed(sections.map((s: Section) => s.section_content)) ? TWITTER_WIDGETS_SCRIPT : '';
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
			alternateLabel: alternate?.label ?? null,
		},
		scripts: [navigationScript, PAGEFIND_SCRIPT, twitterScript].filter(Boolean).join('\n'),
	});

	const response = withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [tags.speech(filename)]);
	await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());

	return response;
}

// SSR 演講頁（單一演講或巢狀清單，直接用 filename 作為路徑；需置於最後的 catch-all 之前）
export async function renderSpeechPage(c: SpeechPageContext): Promise<Response> {
	const cacheKey = buildR2HtmlKey(c.req.url, { includeSearch: false });
	const encodedFilename = c.req.param('filename');

	console.log('SSR Single Speech filename', encodedFilename);

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

	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) {
		console.log('[r2 cache] hit', cacheKey);
		return withCacheHeaders(r2Cached, DEFAULT_HTML_CACHE_CONTROL, [tags.speech(filename)]);
	}

	let speechMeta: SpeechIndexRow | null;
	try {
		speechMeta = await loadSpeechMeta(c, filename);
	} catch (err) {
		console.error('[speech meta] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	if (!speechMeta) {
		const redirectTo = await loadSpeechRedirect(c, filename);
		if (redirectTo) {
			return buildSpeechRedirectResponse(c, `/${encodeURIComponent(redirectTo)}`);
		}
		return c.text('Not Found', 404);
	}

	if (speechMeta.isNested) {
		let nests: Array<{ nest_filename: string; nest_display_name: string; section_count: number; preview?: string }> = [];

		try {
			// Aggregation query: count sections and get first section content per nest
			const result = await c.env.DB.prepare(
				`SELECT
					nest_filename,
					nest_display_name,
					COUNT(*) AS section_count,
					MIN(section_id) AS first_section_id
				FROM speech_content
				WHERE filename = ? AND nest_filename IS NOT NULL
				GROUP BY nest_filename, nest_display_name
				ORDER BY first_section_id ASC`,
			)
				.bind(filename)
				.all();

			if (!result.success) {
				throw new Error('Database query failed');
			}

			// Fetch preview content for each nest's first section in one query
			const firstIds = (result.results as Array<{ first_section_id: number }>).map((r) => r.first_section_id);
			const previewMap = new Map<number, string>();
			if (firstIds.length > 0) {
				const placeholders = firstIds.map(() => '?').join(',');
				const previewResult = await c.env.DB.prepare(
					`SELECT section_id, section_content FROM speech_content WHERE section_id IN (${placeholders})`,
				)
					.bind(...firstIds)
					.all();
				if (previewResult.success) {
					for (const row of previewResult.results as Array<{ section_id: number; section_content: string | null }>) {
						const parsedContent = parseContent(row.section_content ?? '');
						const plain = toPlainText(parsedContent);
						if (plain) previewMap.set(row.section_id, plain.slice(0, 80) + (plain.length > 80 ? '...' : ''));
					}
				}
			}

			nests = (
				result.results as Array<{
					nest_filename: string;
					nest_display_name: string | null;
					section_count: number;
					first_section_id: number;
				}>
			).map((row) => ({
				nest_filename: row.nest_filename,
				nest_display_name: row.nest_display_name ?? row.nest_filename,
				section_count: row.section_count,
				preview: previewMap.get(row.first_section_id),
			}));
		} catch (err) {
			console.error('[nested speech list] DB error', err);
			return c.text('Internal Server Error', 500);
		}

		if (nests.length === 0) {
			return c.text('Not Found', 404);
		}

		const alternate = await loadAlternateInfo(c, filename);
		const styles = [NestedSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
		const head = headForNestedSpeech(speechMeta.display_name ?? filename, filename);
		if (alternate) {
			head.links = [{ rel: 'alternate', href: `https://archive.tw${alternate.url}`, hreflang: alternate.hreflang }];
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
				alternateLabel: alternate?.label ?? null,
			},
			scripts: PAGEFIND_SCRIPT,
		});

		const response = withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [tags.speech(filename)]);
		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());

		return response;
	}

	let sections: Section[];
	try {
		// Query speech_content + speakers only (display_name from speechMeta, skip speech_index join)
		const result = await c.env.DB.prepare(
			`SELECT
				sc.filename,
				sc.section_id,
				sc.previous_section_id,
				sc.next_section_id,
				sc.section_speaker,
				sc.section_content,
				sp.photoURL,
				sp.name
			FROM speech_content sc
			LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
			WHERE sc.filename = ?
			ORDER BY sc.section_id ASC`,
		)
			.bind(filename)
			.all();

		if (!result.success) {
			throw new Error('Database query failed');
		}

		const displayName_ = speechMeta.display_name ?? filename;
		const rawSections = result.results.map((row: Record<string, unknown>) => ({
			filename: row.filename as string,
			section_id: row.section_id as number,
			previous_section_id: row.previous_section_id as number | null,
			next_section_id: row.next_section_id as number | null,
			section_speaker: row.section_speaker as string | null,
			section_content: row.section_content as string,
			display_name: displayName_,
			photoURL: (row.photoURL as string | null) ?? null,
			name: (row.name as string | null) ?? null,
		}));

		if (rawSections.length === 0) {
			return c.text('Not Found', 404);
		}

		sections = normalizeSections(rawSections);
	} catch (err) {
		console.error('[speech SSR] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	const displayName = sections[0].display_name;
	const alternate = await loadAlternateInfo(c, filename);
	const styles = [SingleSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSingleSpeech(displayName, filename);
	if (alternate) {
		head.links = [{ rel: 'alternate', href: `https://archive.tw${alternate.url}`, hreflang: alternate.hreflang }];
	}

	const twitterScript = hasTwitterEmbed(sections.map((s: Section) => s.section_content)) ? TWITTER_WIDGETS_SCRIPT : '';
	const html = await renderHtml(SingleSpeechView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { sections, speechName: filename, displayName, alternateUrl: alternate?.url ?? null, alternateLabel: alternate?.label ?? null },
		scripts: [PAGEFIND_SCRIPT, twitterScript].filter(Boolean).join('\n'),
	});

	const response = withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [tags.speech(filename)]);
	await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());

	return response;
}
