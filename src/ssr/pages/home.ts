import type { AppContext, SpeakerListItem, SpeechListItem } from './shared';
import { PAGEFIND_SCRIPT, STATS_SCRIPT } from './shared';
import { DEFAULT_HTML_CACHE_CONTROL, buildR2HtmlKey, readR2Cache, tags, withCacheHeaders, writeR2Cache } from '../../api/cache';
import { renderHtml } from '../render';
import { headForHome, headForPrivacy, headForSpeeches, headForSpeakers, headForTerms } from '../heads';
import Footer, { styles as FooterStyles } from '../../components/Footer.vue';
import Navbar, { styles as NavbarStyles } from '../../components/Navbar.vue';
import HomeView, { styles as HomeViewStyles } from '../../views/HomeView.vue';
import LegalPrivacyView, { styles as LegalPrivacyViewStyles } from '../../views/LegalPrivacyView.vue';
import LegalTermsView, { styles as LegalTermsViewStyles } from '../../views/LegalTermsView.vue';
import SpeechesView, { styles as SpeechesViewStyles } from '../../views/SpeechesView.vue';
import SpeakersView, { styles as SpeakersViewStyles } from '../../views/SpeakersView.vue';

async function loadSpeeches(c: AppContext): Promise<SpeechListItem[]> {
	const result = await c.env.DB.prepare('SELECT filename, display_name FROM speech_index ORDER BY id ASC').all();

	if (!result.success) {
		throw new Error('Database query failed');
	}

	return (result.results as Array<{ filename: string; display_name: string }>).map((row) => ({
		filename: row.filename,
		display_name: row.display_name,
	}));
}

async function buildSpeechListDataToken(speeches: SpeechListItem[]): Promise<string> {
	const payload = speeches.map((speech) => `${speech.filename}\u0000${speech.display_name}`).join('\u0001');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
	const bytes = Array.from(new Uint8Array(digest.slice(0, 16)));
	const hash = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${speeches.length}-${hash}`;
}

async function loadSpeakers(c: AppContext): Promise<SpeakerListItem[]> {
	const result = await c.env.DB.prepare(
		`SELECT id, route_pathname, name,
			COALESCE(photoURL, (
				SELECT s2.photoURL FROM speakers s2
				WHERE s2.name = speakers.name AND s2.photoURL IS NOT NULL
				ORDER BY s2.id ASC LIMIT 1
			)) AS photoURL
		FROM speakers ORDER BY id ASC`,
	).all();

	if (!result.success) {
		throw new Error('Database query failed');
	}

	return (result.results as Array<{ id: number; route_pathname: string; name: string; photoURL: string | null }>).map((row) => ({
		id: row.id,
		route_pathname: row.route_pathname,
		name: row.name,
		photoURL: row.photoURL ?? null,
	}));
}

export async function renderHomePage(c: AppContext) {
	const styles = [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForHome();
	const html = await renderHtml(HomeView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: {},
		scripts: [PAGEFIND_SCRIPT, STATS_SCRIPT].join('\n'),
	});

	return withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [tags.listHome]);
}

export async function renderSpeechesPage(c: AppContext) {
	let speeches: SpeechListItem[];
	try {
		speeches = await loadSpeeches(c);
	} catch (err) {
		console.error('[speeches SSR] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	const baseCacheKey = buildR2HtmlKey(c.req.url, { includeSearch: false });
	const dataToken = await buildSpeechListDataToken(speeches);
	const cacheKey = `${baseCacheKey}data-${dataToken}`;
	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) return withCacheHeaders(r2Cached, DEFAULT_HTML_CACHE_CONTROL, [tags.listSpeeches]);

	const styles = [SpeechesViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSpeeches();
	const html = await renderHtml(SpeechesView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { speeches },
		scripts: PAGEFIND_SCRIPT,
	});

	let response = c.html(html);
	response = withCacheHeaders(response, DEFAULT_HTML_CACHE_CONTROL, [tags.listSpeeches]);
	if (response.ok && response.status < 400) {
		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());
	}
	return response;
}

export async function renderSpeakersPage(c: AppContext) {
	const cacheKey = buildR2HtmlKey(c.req.url, { includeSearch: false });
	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) return withCacheHeaders(r2Cached, DEFAULT_HTML_CACHE_CONTROL, [tags.listSpeakers]);

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
		props: { speakers },
	});

	let response = c.html(html);
	response = withCacheHeaders(response, DEFAULT_HTML_CACHE_CONTROL, [tags.listSpeakers]);
	if (response.ok && response.status < 400) {
		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());
	}
	return response;
}

export async function renderPrivacyPage(c: AppContext) {
	const styles = [LegalPrivacyViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForPrivacy();
	const html = await renderHtml(LegalPrivacyView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: {},
	});
	return withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [tags.listPrivacy]);
}

export async function renderTermsPage(c: AppContext) {
	const styles = [LegalTermsViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForTerms();
	const html = await renderHtml(LegalTermsView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: {},
	});
	return withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [tags.listTerms]);
}
