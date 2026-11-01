import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vite-plus/test';

function freshBudget() {
	return env.SEARCH_BUDGET.getByName(`test-${crypto.randomUUID()}`);
}

describe('search budget Durable Object', () => {
	it('admits at most ten concurrent requests for one client', async () => {
		const budget = freshBudget();
		const results = await Promise.all(Array.from({ length: 20 }, () => budget.admit('client:203.0.113.5', 1)));
		expect(results.filter((result) => result.allowed)).toHaveLength(10);
		expect(results.filter((result) => !result.allowed)).toHaveLength(10);
		const retry = results.find((result) => !result.allowed);
		expect(retry?.allowed).toBe(false);
		if (retry && !retry.allowed) expect(retry.retryAfterSeconds).toBeGreaterThanOrEqual(1);
		// Denials do not consume the sitewide allowance.
		expect(await budget.admit('client:203.0.113.6', 1)).toEqual({ allowed: true });
	});

	it('shares one exact weighted sitewide limit across distinct clients', async () => {
		const budget = freshBudget();
		const results = await Promise.all(Array.from({ length: 101 }, (_, i) => budget.admit(`client:${i}`, 1)));
		expect(results.filter((result) => result.allowed)).toHaveLength(60);
		expect(results.filter((result) => !result.allowed)).toHaveLength(41);
	});

	it('charges HTML two units and never over-admits at the site limit', async () => {
		const budget = freshBudget();
		const results = await Promise.all(Array.from({ length: 31 }, (_, i) => budget.admit(`client:${i}`, 2)));
		expect(results.filter((result) => result.allowed)).toHaveLength(30);
		expect(results.filter((result) => !result.allowed)).toHaveLength(1);
	});

	it('rejects malformed admission requests without consuming capacity', async () => {
		const budget = freshBudget();
		expect(await budget.admit('', 1)).toEqual({ allowed: false, retryAfterSeconds: 60 });
		expect(await budget.admit('client:valid', 1)).toEqual({ allowed: true });
	});

	it('resets the rolling minute after time advances', async () => {
		const budget = freshBudget();
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
			const first = await Promise.all(Array.from({ length: 10 }, () => budget.admit('client:time', 1)));
			expect(first.every((decision) => decision.allowed)).toBe(true);
			expect((await budget.admit('client:time', 1)).allowed).toBe(false);
			vi.advanceTimersByTime(61_000);
			const second = await budget.admit('client:time', 1);
			expect(second).toEqual({ allowed: true });
		} finally {
			vi.useRealTimers();
		}
	});

	it('computes the wait until enough weighted units expire', async () => {
		const budget = freshBudget();
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
			expect(await budget.admit('client:early-1', 1)).toEqual({ allowed: true });
			vi.advanceTimersByTime(10_000);
			expect(await budget.admit('client:early-2', 1)).toEqual({ allowed: true });
			vi.advanceTimersByTime(10_000);
			const remainder = await Promise.all(Array.from({ length: 58 }, (_, i) => budget.admit(`client:later-${i}`, 1)));
			expect(remainder.every((decision) => decision.allowed)).toBe(true);
			vi.advanceTimersByTime(10_000);
			expect(await budget.admit('client:html', 2)).toEqual({ allowed: false, retryAfterSeconds: 40 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('caps weighted admissions over a rolling day and expires old entries', async () => {
		const budget = freshBudget();
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
			for (let minute = 0; minute < 16; minute++) {
				const batch = await Promise.all(Array.from({ length: 30 }, (_, i) => budget.admit(`client:${minute}-${i}`, 2)));
				expect(batch.every((decision) => decision.allowed)).toBe(true);
				vi.advanceTimersByTime(61_000);
			}
			const finalBatch = await Promise.all(Array.from({ length: 20 }, (_, i) => budget.admit(`client:last-${i}`, 2)));
			expect(finalBatch.every((decision) => decision.allowed)).toBe(true);
			const denied = await budget.admit('client:next', 2);
			expect(denied.allowed).toBe(false);
			if (!denied.allowed) expect(denied.retryAfterSeconds).toBeGreaterThan(84_000);
			vi.advanceTimersByTime(86_400_000);
			expect(await budget.admit('client:next', 2)).toEqual({ allowed: true });
		} finally {
			vi.useRealTimers();
		}
	});
});
