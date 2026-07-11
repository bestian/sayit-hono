export const SEARCH_INDEX_FORMAT_VERSION = 2 as const;
export const SEARCH_INDEX_MANIFEST_VERSION = 1 as const;

export const SEARCH_INDEX_BASELINE_KEY = 'search-index.json';
export const SEARCH_INDEX_BASELINE_BR_KEY = 'search-index.json.br';
export const SEARCH_INDEX_MANIFEST_KEY = 'search-index-manifest.json';
export const SEARCH_STATS_KEY = 'stats.json';
export const SEARCH_UPDATES_PREFIX = 'search-updates';

const NO_SPEAKER_INDEX = -1;

export type SearchDocRecord = {
	filename: string;
	pageUrl: string;
	title: string;
	content: string;
	sectionId: number | null;
	speaker: string | null;
};

export type SearchPackedPage = [filename: string, pageUrl: string, title: string];

export type SearchPackedDoc = [pageIndex: number, sectionId: number | null, speakerIndex: number, content: string];

export type SearchIndexPayload = {
	v: typeof SEARCH_INDEX_FORMAT_VERSION;
	generatedAt: string;
	pages: SearchPackedPage[];
	speakers: string[];
	docs: SearchPackedDoc[];
};

export type SearchOverlayManifestEntry = {
	deleted?: true;
	updatedAt: string;
};

export type SearchOverlayManifest = {
	v: typeof SEARCH_INDEX_MANIFEST_VERSION;
	baselineVersion: string;
	updatedAt: string;
	overlays: Record<string, SearchOverlayManifestEntry>;
};

export function buildSearchOverlayKey(filename: string): string {
	return `${SEARCH_UPDATES_PREFIX}/${encodeURIComponent(filename)}.json`;
}

export function createEmptySearchOverlayManifest(baselineVersion = '', updatedAt = new Date().toISOString()): SearchOverlayManifest {
	return {
		v: SEARCH_INDEX_MANIFEST_VERSION,
		baselineVersion,
		updatedAt,
		overlays: {},
	};
}

export function packSearchDocs(docs: SearchDocRecord[], generatedAt = new Date().toISOString()): SearchIndexPayload {
	const pages: SearchPackedPage[] = [];
	const pageIndexByKey = new Map<string, number>();
	const speakers: string[] = [];
	const speakerIndexByName = new Map<string, number>();
	const packedDocs: SearchPackedDoc[] = [];

	for (const doc of docs) {
		const pageKey = `${doc.filename}\u0000${doc.pageUrl}\u0000${doc.title}`;
		let pageIndex = pageIndexByKey.get(pageKey);
		if (pageIndex == null) {
			pageIndex = pages.length;
			pages.push([doc.filename, doc.pageUrl, doc.title]);
			pageIndexByKey.set(pageKey, pageIndex);
		}

		let speakerIndex = NO_SPEAKER_INDEX;
		if (doc.speaker) {
			const existingSpeakerIndex = speakerIndexByName.get(doc.speaker);
			if (existingSpeakerIndex == null) {
				speakerIndex = speakers.length;
				speakers.push(doc.speaker);
				speakerIndexByName.set(doc.speaker, speakerIndex);
			} else {
				speakerIndex = existingSpeakerIndex;
			}
		}

		packedDocs.push([pageIndex, doc.sectionId, speakerIndex, doc.content]);
	}

	return {
		v: SEARCH_INDEX_FORMAT_VERSION,
		generatedAt,
		pages,
		speakers,
		docs: packedDocs,
	};
}

export function unpackSearchDocs(payload: SearchIndexPayload): SearchDocRecord[] {
	const result: SearchDocRecord[] = [];
	for (const [pageIndex, sectionId, speakerIndex, content] of payload.docs) {
		const page = payload.pages[pageIndex];
		if (!page) continue;
		const [filename, pageUrl, title] = page;
		result.push({
			filename,
			pageUrl,
			title,
			content,
			sectionId,
			speaker: speakerIndex >= 0 ? (payload.speakers[speakerIndex] ?? null) : null,
		});
	}
	return result;
}
