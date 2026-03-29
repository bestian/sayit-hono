import type { Context } from 'hono';
import type { ApiEnv } from '../api/types';
import {
	SEARCH_INDEX_MANIFEST_KEY,
	SEARCH_INDEX_MANIFEST_VERSION,
	SEARCH_STATS_KEY,
	buildSearchOverlayKey,
	createEmptySearchOverlayManifest,
	packSearchDocs,
	type SearchDocRecord,
	type SearchOverlayManifest
} from './indexFormat';
import { docsFromSections, type ApiSection } from './docBuilder';

const SEARCH_MANIFEST_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';
const SEARCH_UPDATE_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';
const SEARCH_STATS_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

type CountRow = {
	count: number | string | null;
};

function normalizeManifest(raw: SearchOverlayManifest | null): SearchOverlayManifest {
	if (!raw || raw.v !== SEARCH_INDEX_MANIFEST_VERSION) {
		return createEmptySearchOverlayManifest();
	}
	return {
		v: SEARCH_INDEX_MANIFEST_VERSION,
		baselineVersion: raw.baselineVersion || '',
		updatedAt: raw.updatedAt || new Date().toISOString(),
		overlays: raw.overlays && typeof raw.overlays === 'object' ? raw.overlays : {}
	};
}

async function readJsonObject<T>(bucket: R2Bucket, key: string): Promise<T | null> {
	const object = await bucket.get(key);
	if (!object) return null;
	return JSON.parse(await object.text()) as T;
}

async function writeJsonObject(
	bucket: R2Bucket,
	key: string,
	value: unknown,
	cacheControl: string
): Promise<void> {
	await bucket.put(key, JSON.stringify(value), {
		httpMetadata: {
			cacheControl,
			contentType: JSON_CONTENT_TYPE
		}
	});
}

export async function readSearchOverlayManifest(bucket: R2Bucket): Promise<SearchOverlayManifest> {
	const raw = await readJsonObject<SearchOverlayManifest>(bucket, SEARCH_INDEX_MANIFEST_KEY);
	return normalizeManifest(raw);
}

async function writeSearchOverlayManifest(bucket: R2Bucket, manifest: SearchOverlayManifest): Promise<void> {
	await writeJsonObject(bucket, SEARCH_INDEX_MANIFEST_KEY, manifest, SEARCH_MANIFEST_CACHE_CONTROL);
}

export async function writeSearchOverlayForSpeech(
	c: Context<ApiEnv>,
	filename: string,
	updatedAt = new Date().toISOString()
): Promise<void> {
	const docs = await buildSearchDocsForSpeech(c, filename);
	const payload = packSearchDocs(docs, updatedAt);
	const manifest = await readSearchOverlayManifest(c.env.SPEECH_CACHE);
	manifest.updatedAt = updatedAt;
	manifest.overlays[filename] = { updatedAt };

	await Promise.all([
		writeJsonObject(c.env.SPEECH_CACHE, buildSearchOverlayKey(filename), payload, SEARCH_UPDATE_CACHE_CONTROL),
		writeSearchOverlayManifest(c.env.SPEECH_CACHE, manifest)
	]);
}

export async function markSpeechDeletedInSearch(
	bucket: R2Bucket,
	filename: string,
	updatedAt = new Date().toISOString()
): Promise<void> {
	const manifest = await readSearchOverlayManifest(bucket);
	manifest.updatedAt = updatedAt;
	manifest.overlays[filename] = { deleted: true, updatedAt };

	await Promise.all([
		bucket.delete(buildSearchOverlayKey(filename)),
		writeSearchOverlayManifest(bucket, manifest)
	]);
}

export async function syncSearchStats(c: Context<ApiEnv>): Promise<void> {
	const [speechesRow, speakersRow, sectionsRow] = await Promise.all([
		c.env.DB.prepare('SELECT COUNT(*) AS count FROM speech_index').first<CountRow>(),
		c.env.DB.prepare('SELECT COUNT(*) AS count FROM speakers').first<CountRow>(),
		c.env.DB.prepare('SELECT COUNT(*) AS count FROM speech_content').first<CountRow>()
	]);

	const stats = {
		speeches: Number(speechesRow?.count ?? 0),
		speakers: Number(speakersRow?.count ?? 0),
		sections: Number(sectionsRow?.count ?? 0)
	};

	await writeJsonObject(c.env.SPEECH_CACHE, SEARCH_STATS_KEY, stats, SEARCH_STATS_CACHE_CONTROL);
}

export async function buildSearchDocsForSpeech(
	c: Context<ApiEnv>,
	filename: string
): Promise<SearchDocRecord[]> {
	const rows = await c.env.DB.prepare(
		`SELECT
			sc.filename,
			sc.nest_filename,
			sc.section_id,
			sc.section_content,
			si.display_name,
			sp.name
		FROM speech_content sc
		LEFT JOIN speech_index si ON sc.filename = si.filename
		LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
		WHERE sc.filename = ?
		ORDER BY sc.section_id ASC`
	).bind(filename).all<ApiSection>();

	const sections = (rows.results ?? []).map((row) => ({
		filename: row.filename,
		nest_filename: row.nest_filename ?? null,
		section_id: Number(row.section_id),
		section_content: row.section_content ?? '',
		display_name: row.display_name ?? filename,
		name: row.name ?? null
	}));

	if (sections.length === 0) return [];
	return docsFromSections(sections, `/${encodeURIComponent(filename)}`, filename);
}
