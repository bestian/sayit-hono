import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

const SPEECH_API_PREFIX = '/api/an/';
const SPEECH_FILE_EXTENSION = '.an';

function getSpeechObjectKey(pathname: string): string | null {
	if (!pathname || pathname === '/') {
		return null;
	}

	if (!pathname.startsWith(SPEECH_API_PREFIX)) {
		return null;
	}

	try {
		const decoded = decodeURIComponent(pathname);
		if (!decoded.endsWith(SPEECH_FILE_EXTENSION)) {
			return null;
		}

		const key = decoded.slice(SPEECH_API_PREFIX.length);
		return key.length > 0 ? key : null;
	} catch {
		return null;
	}
}

function buildSpeechHeaders(baseHeaders: Record<string, string>, object: R2Object | R2ObjectBody) {
	const headers = new Headers(baseHeaders);
	const fallbackContentType = 'text/plain; charset=utf-8';
	const fallbackCacheControl = 'public, max-age=3600';

	headers.set('Cache-Control', object.httpMetadata?.cacheControl ?? fallbackCacheControl);
	headers.set('Content-Type', object.httpMetadata?.contentType ?? fallbackContentType);

	if (typeof object.size === 'number') {
		headers.set('Content-Length', object.size.toString());
	}

	if (object.httpEtag) {
		headers.set('ETag', object.httpEtag);
	}

	return headers;
}

export async function speechAn(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const pathname = new URL(c.req.url).pathname;
	const speechObjectKey = getSpeechObjectKey(pathname);

	if (!speechObjectKey) {
		return c.text('Speech not found', 404, corsHeaders);
	}

	if (c.req.method === 'HEAD') {
		const headObject = await c.env.SPEECH_AN.head(speechObjectKey);
		if (!headObject) {
			return c.text('Speech not found', 404, corsHeaders);
		}

		return new Response(null, {
			status: 200,
			headers: buildSpeechHeaders(corsHeaders, headObject),
		});
	}

	if (c.req.method !== 'GET') {
		return c.text('Method not allowed', 405, corsHeaders);
	}

	const speechObject = await c.env.SPEECH_AN.get(speechObjectKey);
	if (!speechObject) {
		return c.text('Speech not found', 404, corsHeaders);
	}

	return new Response(speechObject.body, {
		status: 200,
		headers: buildSpeechHeaders(corsHeaders, speechObject),
	});
}

