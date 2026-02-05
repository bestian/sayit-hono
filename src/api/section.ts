import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

export async function sectionDetail(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	try {
		const sectionIdParam = c.req.param('section_id');
		const sectionId = Number(sectionIdParam);

		if (!Number.isInteger(sectionId)) {
			return c.json({ error: 'Invalid section id' }, 400, corsHeaders);
		}

		const sectionData = await c.env.DB.prepare('SELECT * FROM sections WHERE section_id = ?')
			.bind(sectionId)
			.first();

		if (!sectionData) {
			return c.json({ error: 'Section not found' }, 404, corsHeaders);
		}

		return c.json(sectionData, 200, corsHeaders);
	} catch (error) {
		console.error('[section] query failed', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeaders);
	}
}

