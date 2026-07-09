// Public routes no longer use caches.default (Workers Cache is front-of-Worker).
// Kept as an empty setup file so vitest.config.mts setupFiles path stays valid.
import { beforeEach } from 'vitest';

beforeEach(() => {
	// no-op
});
