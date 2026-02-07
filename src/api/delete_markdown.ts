import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

export async function deleteMarkdown(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const corsHeadersWithDelete = {
		...corsHeaders,
		'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST, PUT, DELETE'
	};

	try {
		// Auth check
		const authHeader = c.req.header('Authorization');

		if (!authHeader) {
			return c.json({ error: 'Missing Authorization header' }, 401, corsHeadersWithDelete);
		}

		if (!authHeader.startsWith('Bearer ')) {
			return c.json({ error: 'Invalid Authorization format' }, 401, corsHeadersWithDelete);
		}

		const token = authHeader.slice(7);

		const audreytToken = c.env.AUDREYT_TRANSCRIPT_TOKEN;
		const bestianToken = c.env.BESTIAN_TRANSCRIPT_TOKEN;

		if (!token || (token !== audreytToken && token !== bestianToken)) {
			return c.json({ error: 'Forbidden' }, 403, corsHeadersWithDelete);
		}

		// Read filename from body JSON
		let body: { filename?: string };
		try {
			body = await c.req.json();
		} catch (err) {
			console.error('[delete_markdown] JSON parse error', err);
			return c.json({ error: 'Invalid JSON body' }, 400, corsHeadersWithDelete);
		}

		if (!body.filename || typeof body.filename !== 'string') {
			return c.json({ error: 'Missing or invalid filename field' }, 400, corsHeadersWithDelete);
		}

		const filename = body.filename.trim();

		if (!filename) {
			return c.json({ error: 'Filename cannot be empty' }, 400, corsHeadersWithDelete);
		}

		// Delete from D1: speech_content (sections)
		const deleteSectionsResult = await c.env.DB.prepare(
			'DELETE FROM speech_content WHERE filename = ?'
		)
			.bind(filename)
			.run();

		// Delete from D1: speech_index (speech metadata)
		const deleteSpeechResult = await c.env.DB.prepare(
			'DELETE FROM speech_index WHERE filename = ?'
		)
			.bind(filename)
			.run();

		const sectionsDeleted = deleteSectionsResult.meta?.changes ?? 0;
		const speechDeleted = deleteSpeechResult.meta?.changes ?? 0;

		if (sectionsDeleted === 0 && speechDeleted === 0) {
			return c.json(
				{
					success: false,
					message: `No records found for filename: ${filename}`,
					deleted: { sections: 0, speech: 0 }
				},
				404,
				corsHeadersWithDelete
			);
		}

		return c.json(
			{
				success: true,
				message: `Successfully deleted ${filename}`,
				deleted: {
					sections: sectionsDeleted,
					speech: speechDeleted
				}
			},
			200,
			corsHeadersWithDelete
		);
	} catch (error) {
		console.error('[delete_markdown] error', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeadersWithDelete);
	}
}
