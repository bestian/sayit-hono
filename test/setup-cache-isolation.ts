// Public routes no longer use caches.default (Workers Cache is front-of-Worker).
// Mock cloudflare:workers cache.purge so upload invalidation tests can assert
// success without a real Workers Cache purge API in the vitest pool.

import { beforeEach, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
	cache: {
		purge: vi.fn(async () => ({ success: true })),
	},
}));

beforeEach(async () => {
	const { cache } = await import('cloudflare:workers');
	if (cache?.purge && 'mockReset' in cache.purge) {
		(cache.purge as ReturnType<typeof vi.fn>).mockReset();
		(cache.purge as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
	}
});
