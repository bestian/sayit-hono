import { describe, expect, it } from 'vite-plus/test';
import {
	SEARCH_INDEX_FORMAT_VERSION,
	SEARCH_INDEX_MANIFEST_VERSION,
	buildSearchOverlayKey,
	createEmptySearchOverlayManifest,
	packSearchDocs,
	unpackSearchDocs,
	type SearchDocRecord,
} from '../src/search/indexFormat';

const doc = (overrides: Partial<SearchDocRecord> = {}): SearchDocRecord => ({
	filename: '2026-03-24-demo',
	pageUrl: '/2026-03-24-demo',
	title: 'Demo',
	content: 'Body',
	sectionId: null,
	speaker: null,
	...overrides,
});

describe('search/indexFormat', () => {
	describe('buildSearchOverlayKey', () => {
		it('URL-encodes the filename under the updates prefix', () => {
			expect(buildSearchOverlayKey('a/b c')).toBe('search-updates/a%2Fb%20c.json');
		});
	});

	describe('createEmptySearchOverlayManifest', () => {
		it('defaults baselineVersion to empty and stamps updatedAt', () => {
			const m = createEmptySearchOverlayManifest();
			expect(m.v).toBe(SEARCH_INDEX_MANIFEST_VERSION);
			expect(m.baselineVersion).toBe('');
			expect(typeof m.updatedAt).toBe('string');
			expect(m.overlays).toEqual({});
		});

		it('accepts explicit baselineVersion and timestamp', () => {
			const m = createEmptySearchOverlayManifest('v9', '2026-04-01T00:00:00Z');
			expect(m.baselineVersion).toBe('v9');
			expect(m.updatedAt).toBe('2026-04-01T00:00:00Z');
		});
	});

	describe('packSearchDocs + unpackSearchDocs', () => {
		it('dedupes pages and speakers', () => {
			const docs = [
				doc({ speaker: 'A', sectionId: 1, content: 'one' }),
				doc({ speaker: 'A', sectionId: 2, content: 'two' }),
				doc({ speaker: 'B', sectionId: 3, content: 'three' }),
			];
			const packed = packSearchDocs(docs, '2026-04-01T00:00:00Z');
			expect(packed.v).toBe(SEARCH_INDEX_FORMAT_VERSION);
			expect(packed.pages).toHaveLength(1);
			expect(packed.speakers).toEqual(['A', 'B']);
			expect(packed.docs).toHaveLength(3);
			expect(packed.generatedAt).toBe('2026-04-01T00:00:00Z');

			const roundtrip = unpackSearchDocs(packed);
			expect(roundtrip).toEqual(docs);
		});

		it('encodes null speaker as -1 and unpacks as null', () => {
			const packed = packSearchDocs([doc({ speaker: null, sectionId: 5 })]);
			expect(packed.docs[0][2]).toBe(-1);
			const [unpacked] = unpackSearchDocs(packed);
			expect(unpacked.speaker).toBeNull();
			expect(unpacked.sectionId).toBe(5);
		});

		it('unpackSearchDocs skips entries whose page index is missing', () => {
			const packed = packSearchDocs([doc({ content: 'a' })]);
			packed.docs.push([99, null, -1, 'orphan']);
			const result = unpackSearchDocs(packed);
			expect(result.map((r) => r.content)).toEqual(['a']);
		});

		it('handles out-of-range speaker index by falling back to null', () => {
			const packed = packSearchDocs([doc({ speaker: 'x' })]);
			packed.docs[0][2] = 999; // index past speakers length
			const [unpacked] = unpackSearchDocs(packed);
			expect(unpacked.speaker).toBeNull();
		});

		it('treats identical (filename,url,title) triples as one page', () => {
			const packed = packSearchDocs([doc({ content: 'a' }), doc({ content: 'b' })]);
			expect(packed.pages).toHaveLength(1);
			expect(packed.docs.map((d) => d[0])).toEqual([0, 0]);
		});
	});
});
