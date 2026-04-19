import { describe, expect, it, vi } from 'vitest';
import { deleteEdgeCache, readEdgeCache, writeEdgeCache } from '../src/api/cache';

describe('cache.ts edge-cache error handlers', () => {
	it('readEdgeCache returns null when caches.default.match throws', async () => {
		const spy = vi.spyOn(caches.default, 'match').mockImplementation(async () => {
			throw new Error('match failed');
		});
		try {
			const result = await readEdgeCache('boom-read');
			expect(result).toBeNull();
		} finally {
			spy.mockRestore();
		}
	});

	it('writeEdgeCache swallows errors from caches.default.put', async () => {
		const spy = vi.spyOn(caches.default, 'put').mockImplementation(async () => {
			throw new Error('put failed');
		});
		try {
			await writeEdgeCache('boom-write', new Response('x'), 'public, max-age=60');
		} finally {
			spy.mockRestore();
		}
	});

	it('deleteEdgeCache swallows errors from caches.default.delete', async () => {
		const spy = vi.spyOn(caches.default, 'delete').mockImplementation(async () => {
			throw new Error('delete failed');
		});
		try {
			await deleteEdgeCache('boom-delete');
			await deleteEdgeCache('boom-delete-silent', { silent: true });
		} finally {
			spy.mockRestore();
		}
	});
});
