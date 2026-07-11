// Public routes no longer use caches.default (Workers Cache is front-of-Worker).
// Mock cloudflare:workers cache.purge so upload invalidation tests can assert
// success without a real Workers Cache purge API in the vitest pool.

import { beforeEach, vi } from 'vite-plus/test';
import type { cache as CloudflareWorkersCache } from 'cloudflare:workers';

/**
 * Shared mock for `cache.purge`, typed against the real signature
 * (worker-configuration.d.ts's `CacheContext.purge`). Exported so every spec
 * that needs to control purge success/failure imports this instance directly
 * instead of re-capturing `cache.purge` as a bare value (which trips
 * typescript-eslint's unbound-method rule) or casting through `unknown`.
 */
const purgeMockHoisted = vi.hoisted(() => vi.fn<typeof CloudflareWorkersCache.purge>(async () => ({ success: true, errors: [] })));

vi.mock('cloudflare:workers', () => ({
	cache: { purge: purgeMockHoisted },
}));

export const purgeMock = purgeMockHoisted;

beforeEach(() => {
	purgeMock.mockReset();
	purgeMock.mockResolvedValue({ success: true, errors: [] });
});
