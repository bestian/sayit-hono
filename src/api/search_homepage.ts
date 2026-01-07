import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

const DEFAULT_SPEAKER_LIMIT = 5;
const DEFAULT_SECTION_LIMIT = 20;
const MAX_SPEAKER_LIMIT = 10;
const MAX_SECTION_LIMIT = 50;

export type SearchSpeakerResult = {
	route_pathname: string;
	name: string;
	photoURL: string | null;
	snippet: string;
};

export type SearchSectionResult = {
	section_id: number;
	filename: string;
	nest_filename: string | null;
	section_speaker: string | null;
	speaker_name: string | null;
	display_name: string;
	photoURL: string | null;
	snippet: string;
};

export type SearchHomepageResult = {
	query: string;
	speakers: SearchSpeakerResult[];
	sections: SearchSectionResult[];
};

function parseLimit(raw: string | null, fallback: number, max: number) {
	const num = Number(raw);
	if (Number.isFinite(num) && num > 0) {
		return Math.min(Math.floor(num), max);
	}
	return fallback;
}

function normalizeLimit(raw: number | undefined, fallback: number, max: number) {
	if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
		return Math.min(Math.floor(raw), max);
	}
	return fallback;
}

function tokenize(raw: string): string[] {
	return (raw ?? '')
		.trim()
		.split(/\s+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function highlightTerm(value: string, query: string): string {
	if (!value || !query) return value;
	const tokens = tokenize(query);
	if (tokens.length === 0) return escapeHtml(value);
	const encodedTokens = tokens.map((t) => encodeURIComponent(t));

	let highlighted = escapeHtml(value);
	for (const token of [...tokens, ...encodedTokens]) {
		const re = new RegExp(escapeRegExp(token), 'gi');
		highlighted = highlighted.replace(re, (match) => `<em>${match}</em>`);
	}
	return highlighted;
}

function buildFtsQuery(raw: string): string {
	return raw
		.trim()
		.split(/\s+/)
		.map((token) => token.replace(/["'()*^~]/g, '').trim())
		.filter((token) => token.length > 0)
		.map((token) => `${token}*`)
		.join(' AND ');
}

export async function runSearchHomepage(
	env: ApiEnv['Bindings'],
	queryRaw: string,
	limits?: { speakerLimit?: number; sectionLimit?: number }
): Promise<SearchHomepageResult> {
	const query = (queryRaw ?? '').trim();
	const speakerLimit = normalizeLimit(limits?.speakerLimit, DEFAULT_SPEAKER_LIMIT, MAX_SPEAKER_LIMIT);
	const sectionLimit = normalizeLimit(limits?.sectionLimit, DEFAULT_SECTION_LIMIT, MAX_SECTION_LIMIT);

	if (!query) {
		return { query: '', speakers: [], sections: [] };
	}

	const ftsQuery = buildFtsQuery(query);
	if (!ftsQuery) {
		return { query, speakers: [], sections: [] };
	}

	const speakerPromise = env.DB.prepare(
		`SELECT
				route_pathname,
				name,
				photoURL,
				snippet(homepage_search, 2, '<em>', '</em>', '…', 48) AS snippet,
				bm25(homepage_search) AS score
			FROM homepage_search
			WHERE doc_type = 'speaker' AND homepage_search MATCH ?
			ORDER BY score, route_pathname
			LIMIT ?`
	)
		.bind(ftsQuery, speakerLimit)
		.all();

	const sectionPromise = env.DB.prepare(
		`SELECT
				route_pathname AS section_speaker,
				name AS speaker_name,
				filename,
				nest_filename,
				section_id,
				display_name,
				photoURL,
				snippet(homepage_search, 3, '<em>', '</em>', '…', 96) AS snippet,
				bm25(homepage_search) AS score
			FROM homepage_search
			WHERE doc_type = 'section' AND homepage_search MATCH ?
			ORDER BY score, filename, section_id
			LIMIT ?`
	)
		.bind(ftsQuery, sectionLimit)
		.all();

	const [speakerResult, sectionResult] = await Promise.all([speakerPromise, sectionPromise]);

	if (!speakerResult.success || !sectionResult.success) {
		throw new Error('Database query failed');
	}

	let speakers: SearchSpeakerResult[] = (speakerResult.results ?? []).map((row: any) => ({
		route_pathname: row.route_pathname,
		name: row.name,
		photoURL: row.photoURL ?? null,
		snippet: row.snippet ?? ''
	}));


	// for each speaker, find the duplicate speakera by name using D1 and push to speakers
	const additionalSpeakers: SearchSpeakerResult[] = [];
	const seenRoutes = new Set<string>(speakers.map((s) => s.route_pathname));

	for (const speaker of speakers) {
		const speakerDB = await env.DB.prepare(
			'SELECT name, route_pathname, photoURL FROM speakers WHERE name LIKE ?'
		)
			.bind(`%${speaker.name}%`)
			.all();

		if (!speakerDB.success) continue;

		const rows = (speakerDB.results ?? []) as Array<{
			route_pathname?: string;
			name?: string;
			photoURL?: string | null;
		}>;

		for (const row1 of rows) {
			const route = row1.route_pathname ?? '';
			if (!route || seenRoutes.has(route)) continue;
			seenRoutes.add(route);
			additionalSpeakers.push({
				route_pathname: route,
				name: row1.name ?? route,
				photoURL: row1.photoURL ?? speaker.photoURL ?? null,
				snippet: speaker.snippet ?? ''
			});
		}
	}
	speakers = [...additionalSpeakers, ...speakers];


	const sections: SearchSectionResult[] = (sectionResult.results ?? []).map((row: any) => ({
		section_id: row.section_id,
		filename: row.filename,
		nest_filename: row.nest_filename ?? null,
		section_speaker: row.section_speaker ?? null,
		speaker_name: row.speaker_name ?? null,
		display_name: row.display_name ?? row.filename ?? '',
		photoURL: row.photoURL ?? null,
		snippet: row.snippet ?? ''
	}));

	return { query, speakers, sections };
}

export async function searchHomepage(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const url = new URL(c.req.url);
	const query = (url.searchParams.get('q') ?? '').trim();

	const speakerLimit = parseLimit(url.searchParams.get('speakerLimit'), DEFAULT_SPEAKER_LIMIT, MAX_SPEAKER_LIMIT);
	const sectionLimit = parseLimit(url.searchParams.get('sectionLimit'), DEFAULT_SECTION_LIMIT, MAX_SECTION_LIMIT);

	if (!query) {
		return c.json({ query: '', speakers: [], sections: [] }, 200, corsHeaders);
	}

	try {
		const result = await runSearchHomepage(c.env, query, { speakerLimit, sectionLimit });
		return c.json(result, 200, corsHeaders);
	} catch (error) {
		console.error('[search_homepage] query failed', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeaders);
	}
}

