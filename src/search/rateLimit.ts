import type { AppContext } from '../ssr/pages/shared';

const RETRY_AFTER_SECONDS = 60;
const RESPONSE_HEADERS = { 'Cache-Control': 'no-store', 'Retry-After': String(RETRY_AFTER_SECONDS) };

function clientKey(c: AppContext): string {
	const ip = c.req.header('CF-Connecting-IP')?.trim();
	return `client:${ip && ip.length <= 45 && /^[0-9a-f:.]+$/i.test(ip) ? ip : 'unknown'}`;
}

/** Check both search routes before either can make a D1 request. */
export async function checkSearchRateLimit(c: AppContext): Promise<Response | null> {
	const clientLimit = c.env.SEARCH_CLIENT_LIMIT;
	const locationLimit = c.env.SEARCH_LOCATION_LIMIT;
	if (!clientLimit || !locationLimit) {
		console.error('[search] rate limit binding unavailable');
		return c.text('Search temporarily unavailable', 503, RESPONSE_HEADERS);
	}

	try {
		const client = await clientLimit.limit({ key: clientKey(c) });
		if (!client.success) return c.text('Too many search requests', 429, RESPONSE_HEADERS);

		const location = await locationLimit.limit({ key: 'search' });
		if (!location.success) return c.text('Too many search requests', 429, RESPONSE_HEADERS);
	} catch (error) {
		console.error('[search] rate limit check failed', error);
		return c.text('Search temporarily unavailable', 503, RESPONSE_HEADERS);
	}

	return null;
}
