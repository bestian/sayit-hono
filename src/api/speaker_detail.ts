import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

export async function speakerDetail(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	try {
		// 參數應為 :route_pathname_with_json，移除末尾 .json 取得實際路由名稱
		const paramWithJson = c.req.param('route_pathname_with_json') ?? '';
		const fromParam =
			paramWithJson && paramWithJson.endsWith('.json') ? encodeURIComponent(paramWithJson.slice(0, -'.json'.length)) : encodeURIComponent(paramWithJson);

		// 後備：直接從 pathname 擷取（保持 URL 原樣，不做 decode，以符合 DB 中的編碼）
		const match = new URL(c.req.url).pathname.match(/^\/api\/speaker_detail\/([^/]+)\.json$/);
		const fromPathname = match?.[1] ?? '';

		const routePathname = fromParam || fromPathname || null;

		if (!routePathname) {
			return c.json({ error: 'Invalid speaker route pathname' }, 400, corsHeaders);
		}

		const speakerRow = await c.env.DB.prepare('SELECT * FROM speakers_view WHERE route_pathname = ?')
			.bind(routePathname)
			.first();

		if (!speakerRow) {
			return c.json({ error: 'Speaker not found' }, 404, corsHeaders);
		}

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
			ORDER BY sc.section_id ASC`
		)
			.bind(routePathname)
			.all();

		if (!sectionsResult.success) {
			return c.json({ error: 'Database query failed' }, 500, corsHeaders);
		}

		const sections = sectionsResult.results.map((row: any) => ({
			filename: row.filename,
			display_name: row.display_name,
			section_id: row.section_id,
			previous_section_id: row.previous_section_id,
			next_section_id: row.next_section_id,
			section_speaker: row.section_speaker,
			section_content: row.section_content,
		}));

		const longestSection = speakerRow.longest_section_id
			? {
					section_id: speakerRow.longest_section_id,
					section_content: speakerRow.longest_section_content || '',
					section_filename: speakerRow.longest_section_filename || '',
					section_display_name: speakerRow.longest_section_displayname || '',
			  }
			: null;

		const speaker = {
			id: speakerRow.id,
			route_pathname: speakerRow.route_pathname,
			name: speakerRow.name,
			photoURL: speakerRow.photoURL,
			appearances_count: speakerRow.appearances_count ?? 0,
			sections_count: (typeof speakerRow.sections_count === 'number' ? speakerRow.sections_count : null) ?? sections.length,
			sections,
			longest_section: longestSection,
		};

		return c.json(speaker, 200, corsHeaders);
	} catch (error) {
		console.error('[speaker_detail] query failed', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeaders);
	}
}

