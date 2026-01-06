import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

const DEFAULT_SPEAKER_LIMIT = 5;
const DEFAULT_SECTION_LIMIT = 20;
const MAX_SPEAKER_LIMIT = 10;
const MAX_SECTION_LIMIT = 50;

function parseLimit(raw: string | null, fallback: number, max: number) {
	const num = Number(raw);
	if (Number.isFinite(num) && num > 0) {
		return Math.min(Math.floor(num), max);
	}
	return fallback;
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

	const ftsQuery = buildFtsQuery(query);
	if (!ftsQuery) {
		return c.json({ query, speakers: [], sections: [] }, 200, corsHeaders);
	}

	try {
		const speakerPromise = c.env.DB.prepare(
			`SELECT
				route_pathname,
				name,
				photoURL,
				snippet(homepage_search, 2, '<mark>', '</mark>', '…', 48) AS snippet,
				bm25(homepage_search) AS score
			FROM homepage_search
			WHERE doc_type = 'speaker' AND homepage_search MATCH ?
			ORDER BY score, route_pathname
			LIMIT ?`
		)
			.bind(ftsQuery, speakerLimit)
			.all();

		const sectionPromise = c.env.DB.prepare(
			`SELECT
				route_pathname AS section_speaker,
				name AS speaker_name,
				filename,
				nest_filename,
				section_id,
				display_name,
				photoURL,
				snippet(homepage_search, 3, '<mark>', '</mark>', '…', 96) AS snippet,
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
			return c.json({ error: 'Database query failed' }, 500, corsHeaders);
		}

		const speakers = (speakerResult.results ?? []).map((row: any) => ({
			route_pathname: row.route_pathname,
			name: row.name,
			photoURL: row.photoURL ?? null,
			snippet: row.snippet ?? row.name ?? ''
		}));

		const sections = (sectionResult.results ?? []).map((row: any) => ({
			section_id: row.section_id,
			filename: row.filename,
			nest_filename: row.nest_filename ?? null,
			section_speaker: row.section_speaker ?? null,
			speaker_name: row.speaker_name ?? null,
			display_name: row.display_name ?? row.filename ?? '',
			photoURL: row.photoURL ?? null,
			snippet: row.snippet ?? ''
		}));

		return c.json({ query, speakers, sections }, 200, corsHeaders);
	} catch (error) {
		console.error('[search_homepage] query failed', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeaders);
	}
}

