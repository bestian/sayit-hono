import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

export async function speechContent(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	try {
		const pathname = new URL(c.req.url).pathname;
		const prefix = '/api/speech/';
		const encodedFilename = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';

		if (!encodedFilename) {
			return c.json({ error: 'Invalid filename' }, 400, corsHeaders);
		}

		const filename = decodeURIComponent(encodedFilename);

		const result = await c.env.DB.prepare(
			'SELECT filename, section_id, previous_section_id, next_section_id, section_speaker, section_content, display_name, photoURL, name FROM sections WHERE filename = ? ORDER BY section_id ASC'
		)
			.bind(filename)
			.all();

		if (!result.success) {
			return c.json({ error: 'Database query failed' }, 500, corsHeaders);
		}

		const speechRows = result.results.map((row: any) => ({
			filename: row.filename,
			section_id: row.section_id,
			previous_section_id: row.previous_section_id,
			next_section_id: row.next_section_id,
			section_speaker: row.section_speaker,
			section_content: row.section_content,
			display_name: row.display_name,
			photoURL: row.photoURL,
			name: row.name,
		}));

		return c.json(speechRows, 200, corsHeaders);
	} catch (error) {
		console.error('[speech] query failed', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeaders);
	}
}

