import type { Context } from 'hono';
import type { Section, WorkerEnv } from './shared';
import { hasTwitterEmbed, PAGEFIND_SCRIPT, TWITTER_WIDGETS_SCRIPT } from './shared';
import { DEFAULT_HTML_CACHE_CONTROL, buildR2HtmlKey, readR2Cache, tags, withCacheHeaders, writeR2Cache } from '../../api/cache';
import { renderHtml } from '../render';
import { headForSpeaker } from '../heads';
import { normalizeSections } from '../../utils/sectionUtils';
import { buildPaginationPages } from '../../utils/pagination';
import Footer, { styles as FooterStyles } from '../../components/Footer.vue';
import Navbar, { styles as NavbarStyles } from '../../components/Navbar.vue';
import SingleSpeakerView, { styles as SingleSpeakerViewStyles } from '../../views/SingleSpeakerView.vue';

type SpeakerRow = {
	id: number;
	route_pathname: string;
	name: string;
	photoURL: string | null;
	appearances_count: number | null;
	sections_count: number | null;
	longest_section_id: number | null;
	longest_section_content: string | null;
	longest_section_filename: string | null;
	longest_section_displayname: string | null;
};

type SpeakerSectionRow = {
	filename: string;
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
	display_name: string;
};

// Hono's routing guarantees a required named segment is always defined once matched, so
// `c.req.param('route_pathname')` narrows to `string` for this exact registered pattern
// (see src/index.ts's `app.get('/speaker/:route_pathname', ...)`).
type SpeakerPageContext = Context<{ Bindings: WorkerEnv }, '/speaker/:route_pathname'>;

// SSR 講者頁
export async function renderSpeakerPage(c: SpeakerPageContext): Promise<Response> {
	const cacheKey = buildR2HtmlKey(c.req.url);
	const routePathname = encodeURIComponent(c.req.param('route_pathname'));
	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey);
	if (r2Cached) return withCacheHeaders(r2Cached, DEFAULT_HTML_CACHE_CONTROL, [tags.speaker(routePathname)]);

	console.log(routePathname);

	let speaker: {
		id: number;
		route_pathname: string;
		name: string;
		photoURL: string | null;
		appearances_count: number;
		sections_count: number;
		page: number;
		page_size: number;
		total_pages: number;
		pagination_pages: Array<number | 'ellipsis'>;
		sections: Section[];
		longest_section: { section_id: number; section_content: string; section_filename: string; section_display_name: string } | null;
	};
	let sections: Section[];
	try {
		// 取得講者基本資料
		const speakerRow = (await c.env.DB.prepare('SELECT * FROM speakers_view WHERE route_pathname = ?')
			.bind(routePathname)
			.first()) as SpeakerRow | null;

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
			LIMIT ? OFFSET ?`,
		)
			.bind(routePathname, pageSize, offset)
			.all();

		if (!sectionsResult.success) {
			throw new Error('Database query failed');
		}

		sections = normalizeSections(
			(sectionsResult.results as SpeakerSectionRow[]).map((row) => ({
				filename: row.filename,
				display_name: row.display_name,
				section_id: row.section_id,
				previous_section_id: row.previous_section_id,
				next_section_id: row.next_section_id,
				section_speaker: row.section_speaker,
				section_content: row.section_content,
				photoURL: null,
				name: null,
			})),
			false, // 分頁結果，不做重新串接
		);

		const longestSection = speakerRow.longest_section_id
			? {
					section_id: speakerRow.longest_section_id,
					section_content: speakerRow.longest_section_content || '',
					section_filename: speakerRow.longest_section_filename || '',
					section_display_name: speakerRow.longest_section_displayname || '',
				}
			: null;

		const totalSections = (typeof speakerRow.sections_count === 'number' ? speakerRow.sections_count : null) ?? sections.length;
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
			longest_section: longestSection,
		};
	} catch (err) {
		console.error('[speaker SSR] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	const styles = [SingleSpeakerViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSpeaker(speaker.route_pathname);

	const twitterScript = hasTwitterEmbed(speaker.sections.map((s: Section) => s.section_content)) ? TWITTER_WIDGETS_SCRIPT : '';
	const html = await renderHtml(SingleSpeakerView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { initialSpeaker: speaker, routePathname: speaker.route_pathname },
		scripts: ['<script src="/static/speeches/js/masonry.pkgd.min.js"></script>', PAGEFIND_SCRIPT, twitterScript].filter(Boolean).join('\n'),
	});

	const response = withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [tags.speaker(routePathname)]);
	console.log('writing to R2 cache', cacheKey);
	await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone());

	return response;
}
