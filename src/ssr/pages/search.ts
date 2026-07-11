import type { AppContext } from './shared';
import { PAGEFIND_SCRIPT } from './shared';
import { SEARCH_HTML_CACHE_CONTROL, tags, withCacheHeaders } from '../../api/cache';
import { renderHtml } from '../render';
import { headForSearch } from '../heads';
import { buildPaginationPages } from '../../utils/pagination';
import { escapeHtml, parseContent, toPlainText } from '../../utils/textUtils';
import Footer, { styles as FooterStyles } from '../../components/Footer.vue';
import Navbar, { styles as NavbarStyles } from '../../components/Navbar.vue';
import SearchResultView, { styles as SearchResultViewStyles } from '../../views/SearchResultView.vue';

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 80;
export const SEARCH_DEFAULT_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGE_SIZE = 50;
export const SEARCH_SPEAKER_LIMIT = 10;

type SearchResultRow = {
	filename: string;
	nest_filename?: string | null;
	display_name: string;
	section_id: number | string | null;
	section_content: string | null;
	speaker_name?: string | null;
};

type SearchSpeakerRow = {
	id: number;
	route_pathname: string;
	name: string;
	photoURL: string | null;
};

type SearchSpeakerResult = {
	route_pathname: string;
	name: string;
	photoURL: string | null;
	snippet: string;
};

type SearchSectionResult = {
	section_id: number;
	filename: string;
	nest_filename: string | null;
	section_speaker: string | null;
	speaker_name: string | null;
	display_name: string;
	photoURL: string | null;
	snippet: string;
};

export type SearchPageResult = {
	query: string;
	speakers: SearchSpeakerResult[];
	sections: SearchSectionResult[];
	page: number;
	page_size: number;
	total_pages: number;
	total_sections: number;
	pagination_pages: Array<number | 'ellipsis'>;
	filteredSpeakerId?: number;
	filteredSpeakerName?: string | null;
};

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeSearchQuery(value: string): string[] {
	return value
		.trim()
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function highlightSearchText(value: string, query: string): string {
	const tokens = tokenizeSearchQuery(query);
	if (!value || tokens.length === 0) return escapeHtml(value || '');

	let highlighted = escapeHtml(value);
	for (const token of tokens) {
		const pattern = new RegExp(escapeRegExp(escapeHtml(token)), 'gi');
		highlighted = highlighted.replace(pattern, (match) => `<em>${match}</em>`);
	}
	return highlighted;
}

function buildSearchSnippet(raw: string, query: string, radius = 80): string {
	const text = raw.replace(/\s+/g, ' ').trim();
	if (!text) return '';

	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const matchIndex = lowerText.indexOf(lowerQuery);

	if (matchIndex < 0) {
		return text.length <= radius * 2 ? text : `${text.slice(0, radius * 2).trimEnd()}...`;
	}

	const start = Math.max(0, matchIndex - Math.floor(radius / 2));
	const end = Math.min(text.length, matchIndex + query.length + radius);
	let snippet = text.slice(start, end).trim();
	if (start > 0) snippet = `...${snippet}`;
	if (end < text.length) snippet = `${snippet}...`;
	return snippet;
}

export function normalizeSearchQuery(raw: string | null | undefined): string {
	const value = (raw || '').trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
	return value;
}

export async function runSearchQuery(
	c: AppContext,
	{
		query,
		page = 1,
		pageSize = SEARCH_DEFAULT_PAGE_SIZE,
		speakerId,
	}: {
		query: string;
		page?: number;
		pageSize?: number;
		speakerId?: number;
	},
): Promise<SearchPageResult> {
	const normalizedQuery = normalizeSearchQuery(query);
	const safePageSize = Math.max(1, Math.min(SEARCH_MAX_PAGE_SIZE, Math.floor(pageSize || SEARCH_DEFAULT_PAGE_SIZE)));
	const safePage = Math.max(1, Math.floor(page || 1));

	let filteredSpeakerId: number | undefined;
	let filteredSpeakerName: string | null = null;
	let filteredSpeakerRoutePathname: string | null = null;
	if (speakerId && Number.isFinite(speakerId) && speakerId > 0) {
		const speakerRow = (await c.env.DB.prepare('SELECT id, route_pathname, name FROM speakers WHERE id = ?')
			.bind(Math.floor(speakerId))
			.first()) as { id: number; route_pathname: string; name: string } | null;
		if (speakerRow?.route_pathname) {
			filteredSpeakerId = Number(speakerRow.id);
			filteredSpeakerRoutePathname = speakerRow.route_pathname;
			filteredSpeakerName = speakerRow.name ?? null;
		}
	}

	if (normalizedQuery.length < SEARCH_MIN_QUERY_LENGTH) {
		return {
			query: normalizedQuery,
			speakers: [],
			sections: [],
			page: 1,
			page_size: safePageSize,
			total_pages: 1,
			total_sections: 0,
			pagination_pages: [1],
			filteredSpeakerId,
			filteredSpeakerName,
		};
	}

	const normalizedLowerQuery = normalizedQuery.toLowerCase();
	const sectionFilterSql = filteredSpeakerRoutePathname ? 'AND sc.section_speaker = ?' : '';
	const sectionFilterBindings = filteredSpeakerRoutePathname ? [filteredSpeakerRoutePathname] : [];

	const [speakerResult, totalSectionsRow] = await Promise.all([
		filteredSpeakerRoutePathname
			? Promise.resolve({ success: true, results: [] as SearchSpeakerRow[] })
			: c.env.DB.prepare(
					`SELECT id, route_pathname, name, photoURL
				FROM speakers
				WHERE instr(lower(COALESCE(name, '')), ?) > 0
				ORDER BY instr(lower(COALESCE(name, '')), ?), name ASC
				LIMIT ?`,
				)
					.bind(normalizedLowerQuery, normalizedLowerQuery, SEARCH_SPEAKER_LIMIT)
					.all(),
		c.env.DB.prepare(
			`SELECT COUNT(*) AS count
			FROM speech_content sc
			LEFT JOIN speech_index si ON sc.filename = si.filename
			LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
			WHERE (
				instr(lower(COALESCE(si.display_name, '')), ?) > 0
				OR instr(lower(COALESCE(sp.name, '')), ?) > 0
				OR instr(lower(COALESCE(sc.section_content, '')), ?) > 0
			) ${sectionFilterSql}`,
		)
			.bind(normalizedLowerQuery, normalizedLowerQuery, normalizedLowerQuery, ...sectionFilterBindings)
			.first() as Promise<{ count: number | string | null } | null>,
	]);

	if (!speakerResult.success) {
		throw new Error('Database query failed');
	}

	const totalSections = Number(totalSectionsRow?.count ?? 0);
	const totalPages = Math.max(1, Math.ceil(totalSections / safePageSize));
	const resolvedPage = Math.min(safePage, totalPages);
	const offset = (resolvedPage - 1) * safePageSize;

	const sectionResult = await c.env.DB.prepare(
		`SELECT
			sc.filename,
			sc.nest_filename,
			sc.section_id,
			sc.section_speaker,
			sc.section_content,
			si.display_name,
			sp.name AS speaker_name,
			sp.photoURL
		FROM speech_content sc
		LEFT JOIN speech_index si ON sc.filename = si.filename
		LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
		WHERE (
			instr(lower(COALESCE(si.display_name, '')), ?) > 0
			OR instr(lower(COALESCE(sp.name, '')), ?) > 0
			OR instr(lower(COALESCE(sc.section_content, '')), ?) > 0
		) ${sectionFilterSql}
		ORDER BY
			CASE
				WHEN instr(lower(COALESCE(si.display_name, '')), ?) > 0 THEN 0
				WHEN instr(lower(COALESCE(sp.name, '')), ?) > 0 THEN 1
				ELSE 2
			END,
			sc.filename DESC,
			sc.section_id ASC
		LIMIT ? OFFSET ?`,
	)
		.bind(
			normalizedLowerQuery,
			normalizedLowerQuery,
			normalizedLowerQuery,
			...sectionFilterBindings,
			normalizedLowerQuery,
			normalizedLowerQuery,
			safePageSize,
			offset,
		)
		.all();

	if (!sectionResult.success) {
		throw new Error('Database query failed');
	}

	return {
		query: normalizedQuery,
		speakers: (speakerResult.results as SearchSpeakerRow[]).map((row: SearchSpeakerRow) => ({
			route_pathname: row.route_pathname,
			name: row.name,
			photoURL: row.photoURL ?? null,
			snippet: highlightSearchText(row.name ?? '', normalizedQuery),
		})),
		sections: (sectionResult.results as Array<SearchResultRow & { section_speaker?: string | null; photoURL?: string | null }>).map(
			(row) => ({
				section_id: Number(row.section_id),
				filename: row.filename,
				nest_filename: row.nest_filename ?? null,
				section_speaker: row.section_speaker ?? null,
				speaker_name: row.speaker_name ?? null,
				display_name: row.display_name,
				photoURL: row.photoURL ?? null,
				snippet: highlightSearchText(
					buildSearchSnippet(toPlainText(parseContent(row.section_content ?? '')), normalizedQuery),
					normalizedQuery,
				),
			}),
		),
		page: resolvedPage,
		page_size: safePageSize,
		total_pages: totalPages,
		total_sections: totalSections,
		pagination_pages: buildPaginationPages(resolvedPage, totalPages),
		filteredSpeakerId,
		filteredSpeakerName,
	};
}

export async function renderSearchPage(c: AppContext) {
	const url = new URL(c.req.url);
	const query = normalizeSearchQuery(url.searchParams.get('q'));
	const pageParam = Number(url.searchParams.get('page') || '1');
	const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
	const speakerParam = Number(url.searchParams.get('p') || '');
	const speakerId = Number.isFinite(speakerParam) && speakerParam > 0 ? Math.floor(speakerParam) : undefined;

	let result: SearchPageResult;
	try {
		result = await runSearchQuery(c, { query, page, pageSize: SEARCH_DEFAULT_PAGE_SIZE, speakerId });
	} catch (err) {
		console.error('[search SSR] query failed', err);
		return c.text('Internal Server Error', 500);
	}

	const styles = [SearchResultViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');
	const head = headForSearch(result.query);
	const html = await renderHtml(SearchResultView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: result,
		scripts: PAGEFIND_SCRIPT,
	});

	return withCacheHeaders(c.html(html), SEARCH_HTML_CACHE_CONTROL, [tags.listSearch]);
}
