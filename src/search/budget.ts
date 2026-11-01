import type { AppContext } from '../ssr/pages/shared';

function clientKey(c: AppContext): string {
	const ip = c.req.header('CF-Connecting-IP')?.trim();
	return `client:${ip && ip.length <= 45 && /^[0-9a-f:.]+$/i.test(ip) ? ip : 'unknown'}`;
}

/** Reserve search work in the sitewide ledger before the first D1 read. */
export async function checkSearchBudget(c: AppContext, units: 1 | 2): Promise<Response | null> {
	const budget = c.env.SEARCH_BUDGET;
	if (!budget) {
		console.error('[search] budget binding unavailable');
		return c.text('Search temporarily unavailable', 503, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
	}

	try {
		const decision = await budget.getByName('sitewide').admit(clientKey(c), units);
		if (decision.allowed === true) return null;
		if (decision.allowed !== false || !Number.isSafeInteger(decision.retryAfterSeconds) || decision.retryAfterSeconds < 1) {
			throw new Error('Invalid search budget response');
		}
		return c.text('Too many search requests', 429, {
			'Cache-Control': 'no-store',
			'Retry-After': String(decision.retryAfterSeconds),
		});
	} catch (error) {
		console.error('[search] budget admission failed', error);
		return c.text('Search temporarily unavailable', 503, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
	}
}
