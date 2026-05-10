import { describe, expect, it } from 'vitest';
import {
	markSpeechDeletedInSearch,
	readSearchOverlayManifest,
	syncSearchStats,
	writeSearchOverlayForSpeech
} from '../src/search/runtime';
import {
	SEARCH_INDEX_MANIFEST_KEY,
	SEARCH_INDEX_MANIFEST_VERSION,
	SEARCH_STATS_KEY,
	buildSearchOverlayKey
} from '../src/search/indexFormat';

type StoreEntry = { body: string };

function createBucket(initial: Record<string, string> = {}) {
	const store = new Map<string, StoreEntry>();
	for (const [k, v] of Object.entries(initial)) store.set(k, { body: v });
	const bucket = {
		get: async (key: string) => {
			const entry = store.get(key);
			if (!entry) return null;
			return { text: async () => entry.body } as any;
		},
		put: async (key: string, body: string) => {
			store.set(key, { body });
		},
		delete: async (keys: string | string[]) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
		}
	} as any;
	return { bucket, store };
}

function createContext(bucket: any, countRows: { speeches?: number; speakers?: number; sections?: number } = {}) {
	const firstFor = (sql: string) => {
		if (sql.includes('FROM speech_index')) return { count: countRows.sections ?? 3 };
		if (sql.includes('FROM speakers')) return { count: countRows.speakers ?? 2 };
		if (sql.includes('FROM speech_content')) return { count: countRows.speeches ?? 5 };
		return null;
	};
	return {
		env: {
			SPEECH_CACHE: bucket,
			DB: {
				prepare: (sql: string) => ({
					bind: (..._args: unknown[]) => ({
						all: async () => ({
							success: true,
							results: [
								{
									filename: '2026-demo',
									nest_filename: null,
									section_id: 1,
									section_content: '<p>hi</p>',
									display_name: 'Demo',
									name: 'Audrey'
								}
							]
						}),
						first: async () => firstFor(sql)
					}),
					first: async () => firstFor(sql)
				})
			}
		}
	} as any;
}

describe('search/runtime.readSearchOverlayManifest', () => {
	it('returns an empty manifest when nothing is stored', async () => {
		const { bucket } = createBucket();
		const manifest = await readSearchOverlayManifest(bucket);
		expect(manifest.v).toBe(SEARCH_INDEX_MANIFEST_VERSION);
		expect(manifest.overlays).toEqual({});
	});

	it('returns an empty manifest when stored version mismatches', async () => {
		const { bucket } = createBucket({
			[SEARCH_INDEX_MANIFEST_KEY]: JSON.stringify({ v: 999, baselineVersion: 'v9', updatedAt: 'x', overlays: { a: { updatedAt: 'x' } } })
		});
		const manifest = await readSearchOverlayManifest(bucket);
		expect(manifest.baselineVersion).toBe('');
		expect(manifest.overlays).toEqual({});
	});

	it('normalizes a valid manifest with missing fields', async () => {
		const { bucket } = createBucket({
			[SEARCH_INDEX_MANIFEST_KEY]: JSON.stringify({ v: SEARCH_INDEX_MANIFEST_VERSION })
		});
		const manifest = await readSearchOverlayManifest(bucket);
		expect(manifest.baselineVersion).toBe('');
		expect(manifest.overlays).toEqual({});
		expect(typeof manifest.updatedAt).toBe('string');
	});

	it('keeps overlays when they come as a plain object', async () => {
		const { bucket } = createBucket({
			[SEARCH_INDEX_MANIFEST_KEY]: JSON.stringify({
				v: SEARCH_INDEX_MANIFEST_VERSION,
				baselineVersion: 'v1',
				updatedAt: '2026-04-01T00:00:00Z',
				overlays: { demo: { updatedAt: 'now' } }
			})
		});
		const manifest = await readSearchOverlayManifest(bucket);
		expect(manifest.overlays).toEqual({ demo: { updatedAt: 'now' } });
	});
});

describe('search/runtime.writeSearchOverlayForSpeech', () => {
	it('writes the per-speech overlay and updates the manifest', async () => {
		const { bucket, store } = createBucket();
		const c = createContext(bucket);
		await writeSearchOverlayForSpeech(c, '2026-demo', '2026-04-02T00:00:00Z');

		const overlayKey = buildSearchOverlayKey('2026-demo');
		expect(store.has(overlayKey)).toBe(true);
		const overlay = JSON.parse(store.get(overlayKey)!.body);
		expect(overlay.v).toBe(2);
		expect(overlay.pages).toHaveLength(1);

		const manifest = JSON.parse(store.get(SEARCH_INDEX_MANIFEST_KEY)!.body);
		expect(manifest.overlays['2026-demo']).toEqual({ updatedAt: '2026-04-02T00:00:00Z' });
	});

	it('still writes the manifest when the speech has no sections', async () => {
		const { bucket, store } = createBucket();
		const emptyC = {
			env: {
				SPEECH_CACHE: bucket,
				DB: {
					prepare: () => ({
						bind: () => ({
							all: async () => ({ success: true, results: [] }),
							first: async () => null
						})
					})
				}
			}
		} as any;

		await writeSearchOverlayForSpeech(emptyC, 'no-sections');
		const manifest = JSON.parse(store.get(SEARCH_INDEX_MANIFEST_KEY)!.body);
		expect(manifest.overlays['no-sections']).toBeDefined();
	});
});

describe('search/runtime.markSpeechDeletedInSearch', () => {
	it('marks the overlay as deleted and removes the per-speech object', async () => {
		const { bucket, store } = createBucket({
			[buildSearchOverlayKey('gone')]: JSON.stringify({ v: 2, pages: [], speakers: [], docs: [], generatedAt: 'x' })
		});
		await markSpeechDeletedInSearch(bucket, 'gone', '2026-04-02T00:00:00Z');

		expect(store.has(buildSearchOverlayKey('gone'))).toBe(false);
		const manifest = JSON.parse(store.get(SEARCH_INDEX_MANIFEST_KEY)!.body);
		expect(manifest.overlays.gone).toEqual({ deleted: true, updatedAt: '2026-04-02T00:00:00Z' });
	});
});

describe('search/runtime.syncSearchStats', () => {
	it('writes counts gathered from DB into stats.json', async () => {
		const { bucket, store } = createBucket();
		const c = createContext(bucket, { speeches: 10, speakers: 20, sections: 30 });
		await syncSearchStats(c);
		const stats = JSON.parse(store.get(SEARCH_STATS_KEY)!.body);
		expect(stats).toEqual({ speeches: 10, speakers: 20, sections: 30 });
	});

	it('tolerates missing count rows by defaulting to 0', async () => {
		const { bucket, store } = createBucket();
		const c = {
			env: {
				SPEECH_CACHE: bucket,
				DB: {
					prepare: () => ({
						bind: () => ({ first: async () => null, all: async () => ({ success: true, results: [] }) }),
						first: async () => null,
						all: async () => ({ success: true, results: [] })
					})
				}
			}
		} as any;
		await syncSearchStats(c);
		const stats = JSON.parse(store.get(SEARCH_STATS_KEY)!.body);
		expect(stats).toEqual({ speeches: 0, speakers: 0, sections: 0 });
	});
});
