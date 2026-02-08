import type { Context } from 'hono';
import type { ApiEnv } from './types';

export const ALLOWED_ORIGINS = [
	'http://localhost:5173',
	'https://sayit-f5d.pages.dev',
	'https://sayit.archive.tw',
];

const DEFAULT_ALLOWED_METHODS = 'GET, HEAD, OPTIONS, POST, PUT, DELETE';
const DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization, X-GitHub-Repository';

export function isOriginAllowed(origin: string | null) {
	if (!origin) return false;
	return ALLOWED_ORIGINS.includes(origin);
}

export function getCorsHeaders(origin: string | null) {
	const normalizedOrigin = origin || '';
	const allowedOrigin = isOriginAllowed(normalizedOrigin) ? normalizedOrigin : 'null';

	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Methods': DEFAULT_ALLOWED_METHODS,
		'Access-Control-Allow-Headers': DEFAULT_ALLOWED_HEADERS,
		'Access-Control-Max-Age': '86400',
		'Vary': 'Origin',
	};
}

export function handleOptions(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	if (!isOriginAllowed(origin)) {
		return c.text('Origin not allowed', 403, corsHeaders);
	}

	return c.text('', 200, corsHeaders);
}

