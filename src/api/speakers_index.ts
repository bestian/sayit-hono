import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

export async function speakersIndex(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	try {
		const result = await c.env.DB.prepare('SELECT id, route_pathname, name, photoURL FROM speakers ORDER BY id ASC').all();

		if (!result.success) {
			return c.json({ error: 'Database query failed' }, 500, corsHeaders);
		}

		const rows = result.results.map((row: any) => ({
			id: row.id,
			route_pathname: row.route_pathname,
			name: row.name,
			photoURL: row.photoURL,
		}));

		return c.json(rows, 200, corsHeaders);
	} catch (error) {
		console.error('[speakers_index] query failed', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeaders);
	}
}

