import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

export async function uploadMarkdown(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const corsHeadersWithPost = {
		...corsHeaders,
		'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST, PUT'
	};

	try {
		// 提取 Authorization header
		const authHeader = c.req.header('Authorization');

		if (!authHeader) {
			return c.text('Forbidden', 400, corsHeadersWithPost);
		}

		// 檢查 Bearer token 格式
		if (!authHeader.startsWith('Bearer ')) {
			return c.text('Forbidden', 400, corsHeadersWithPost);
		}

		const token = authHeader.slice(7); // 移除 "Bearer " 前綴

		// 驗證 token 是否匹配 AUDREYT_TRANSCRIPT_TOKEN 或 BESTIAN_TRANSCRIPT_TOKEN
		const audreytToken = c.env.AUDREYT_TRANSCRIPT_TOKEN;
		const bestianToken = c.env.BESTIAN_TRANSCRIPT_TOKEN;

		if (!token || (token !== audreytToken && token !== bestianToken)) {
			return c.text('Forbidden', 400, corsHeadersWithPost);
		}

		// 讀取請求 body 的 JSON 格式
		let body: { markdown?: string };
		try {
			body = await c.req.json();
		} catch (err) {
			console.error('[upload_markdown] JSON parse error', err);
			return c.json({ error: 'Invalid JSON body' }, 400, corsHeadersWithPost);
		}

		// 檢查 markdown 欄位是否存在
		if (!body.markdown || typeof body.markdown !== 'string') {
			return c.json({ error: 'Missing or invalid markdown field' }, 400, corsHeadersWithPost);
		}

		// 驗證成功：回傳 markdown 原始內容
		return c.text(body.markdown, 200, {
			...corsHeadersWithPost,
			'Content-Type': 'text/plain; charset=utf-8'
		});
	} catch (error) {
		console.error('[upload_markdown] error', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeadersWithPost);
	}
}
