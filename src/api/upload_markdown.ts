import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

const corsMethods = 'GET, HEAD, OPTIONS, POST, PUT, DELETE';

function transformFilename(input: string): string {
	const lower = input.toLowerCase();
	const replaced = lower.replace(/-ai-/g, 'ai-');
	return replaced.slice(0, 50);
}

export async function uploadMarkdown(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const corsHeadersWithMethods = {
		...corsHeaders,
		'Access-Control-Allow-Methods': corsMethods
	};

	try {
		// Auth check
		const authHeader = c.req.header('Authorization');

		if (!authHeader) {
			return c.text('Forbidden', 400, corsHeadersWithMethods);
		}

		if (!authHeader.startsWith('Bearer ')) {
			return c.text('Forbidden', 400, corsHeadersWithMethods);
		}

		const token = authHeader.slice(7);

		const audreytToken = c.env.AUDREYT_TRANSCRIPT_TOKEN;
		const bestianToken = c.env.BESTIAN_TRANSCRIPT_TOKEN;

		if (!token || (token !== audreytToken && token !== bestianToken)) {
			return c.text('Forbidden', 400, corsHeadersWithMethods);
		}

		const method = c.req.method;

		if (method === 'DELETE') {
			// DELETE: 從 body 讀取 filename，刪除 D1 中的紀錄

			console.log('[upload_markdown] DELETE');
			let body: { filename?: string };

			try {
				body = await c.req.json();
				console.log('[upload_markdown] DELETE body:', body);

				if (!body.filename || typeof body.filename !== 'string') {
					return c.json({ error: 'Missing or invalid filename field' }, 400, corsHeadersWithMethods);
				}

				const inputFilename = body.filename.trim();

				if (!inputFilename) {
					return c.json({ error: 'Filename cannot be empty' }, 400, corsHeadersWithMethods);
				}

				const filename = transformFilename(inputFilename);
				console.log('[upload_markdown] filename transform:', { input: inputFilename, output: filename });

				// Delete from D1: speech_content (sections)
				console.log('[upload_markdown] DELETE sections from D1:', filename);
				const deleteSectionsResult = await c.env.DB.prepare(
					'DELETE FROM speech_content WHERE filename = ?'
				)
					.bind(filename)
					.run();

				// Delete from D1: speech_index (speech metadata)
				console.log('[upload_markdown] DELETE speech_index from D1:', filename);
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
						corsHeadersWithMethods
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
					corsHeadersWithMethods
				);
			} catch (err) {
				console.error('[upload_markdown] DELETE JSON parse error', err);
				return c.json({ error: 'Invalid JSON body' }, 400, corsHeadersWithMethods);
			}
		}  else if (method === 'POST') {
			// POST: 讀取 markdown 欄位，回傳原始內容
			let body: { markdown?: string };
			try {
				body = await c.req.json();
				console.log('[upload_markdown] POST body:', body);
			} catch (err) {
				console.error('[upload_markdown] POST JSON parse error', err);
				return c.json({ error: 'Invalid JSON body' }, 400, corsHeadersWithMethods);
			}

			if (!body.markdown || typeof body.markdown !== 'string') {
				return c.json({ error: 'Missing or invalid markdown field' }, 400, corsHeadersWithMethods);
			}

			return c.text(body.markdown, 200, {
				...corsHeadersWithMethods,
				'Content-Type': 'text/plain; charset=utf-8'
			});
		} else {
			console.error('[upload_markdown] method not supported', method);
			return c.json({ error: 'Method not supported' }, 400, corsHeadersWithMethods);
		}
	} catch (error) {
		console.error('[upload_markdown] error', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeadersWithMethods);
	}
}
