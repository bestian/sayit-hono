/**
 * Pure cache-invalidation plan generator.
 *
 * Extracts the key/tag computation from three impure invalidation functions in
 * `src/api/upload_markdown.ts` (`invalidateSpeechCaches`, `invalidateSpeakerCaches`,
 * `invalidateListPageCaches`) into side-effect-free helpers that compose the
 * existing key-builders from `src/api/cache.ts`.
 *
 * The caller is responsible for:
 *   - extracting `host` from the request URL,
 *   - fetching section IDs from D1 (for the speech shape),
 *   - performing the actual R2 deletes and Workers Cache purges.
 *
 * This module produces ONLY the string keys and tag values — no I/O.
 */
import { CACHE_KEY_VERSION, r2AnKey, r2MdKey, r2OgSpeechKey, r2OgSectionKey, tags } from '../api/cache';

/**
 * Description of what changed — drives which R2 origin keys and Workers Cache
 * tags must be invalidated. One input shape per existing invalidation call site.
 */
export type CacheInvalidationInput =
	| { kind: 'speech'; host: string; filename: string; sectionIds: number[] }
	| { kind: 'speaker'; host: string; routePathnames: string[] }
	| { kind: 'list'; host: string; home: boolean; speeches: boolean; speakers: boolean };

/** R2 origin keys and Workers Cache tags to purge. */
export interface CacheInvalidationOutput {
	r2Keys: string[];
	tags: string[];
}

/**
 * Compute R2 origin keys and Workers Cache tags to invalidate after a speech
 * content or .an/.md change. `sectionIds` should be the complete set of section
 * IDs for this speech (caller merges `extraSectionIds` with D1-fetched IDs).
 *
 * Faithfully mirrors `invalidateSpeechCaches` from `upload_markdown.ts`:
 * - R2 keys: `an/{filename}`, `md/{filename}`, raw HTML key, percent-encoded HTML
 *   key, OG speech PNG, + 2 keys per section ID (HTML + OG PNG).
 * - Tags: `speech:{filename}`, `list:home`, `list:speeches`, `list:rss`.
 * - R2 keys are NOT deduplicated (array, matching original); `sectionIds` ARE
 *   deduplicated and finite-filtered (Set, matching original).
 */
// LemmaScript annotations skipped: this function uses Set, Number.isFinite,
// and encodeURIComponent — none lsc-expressible — so lsc skips it and any
// ensures on it would be unverifiable. Additionally the imported
// r2OgSectionKey has a `number | string` param that Dafny cannot parse.
export function planSpeechInvalidation(host: string, filename: string, sectionIds: number[]): CacheInvalidationOutput {
	const encodedFilename = encodeURIComponent(filename);
	const r2Keys: string[] = [
		r2AnKey(filename),
		r2MdKey(filename),
		`${CACHE_KEY_VERSION}/${host}/${filename}`,
		`${CACHE_KEY_VERSION}/${host}/${encodedFilename}`,
		r2OgSpeechKey(filename),
	];

	const filteredSectionIds = new Set<number>();
	for (const id of sectionIds) {
		if (Number.isFinite(id)) filteredSectionIds.add(Number(id));
	}

	for (const sectionId of filteredSectionIds) {
		r2Keys.push(`${CACHE_KEY_VERSION}/${host}/speech/${sectionId}`);
		r2Keys.push(r2OgSectionKey(sectionId));
	}

	const purgeTags = [tags.speech(filename), tags.listHome, tags.listSpeeches, tags.listRss];

	return { r2Keys, tags: purgeTags };
}

/**
 * Compute R2 origin keys and Workers Cache tags to invalidate after a speaker
 * or speech-speaker association change.
 *
 * Faithfully mirrors `invalidateSpeakerCaches` from `upload_markdown.ts`:
 * - R2 keys: always `${version}/{host}/speakers`, + raw and percent-encoded
 *   `${version}/{host}/speaker/{path}` per pathname (deduplicated via Set).
 * - Tags: `speaker:{pathname}` per pathname + `list:speakers`
 *   (NOT deduplicated, matching original).
 */
// LemmaScript annotations skipped: uses Set and encodeURIComponent (not
// lsc-expressible); lsc skips this function, so ensures would be unverifiable.
export function planSpeakerInvalidation(host: string, routePathnames: string[]): CacheInvalidationOutput {
	const r2Keys = new Set<string>([`${CACHE_KEY_VERSION}/${host}/speakers`]);

	for (const routePathname of routePathnames) {
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speaker/${routePathname}`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speaker/${encodeURIComponent(routePathname)}`);
	}

	const purgeTags: string[] = [];
	for (const p of routePathnames) {
		purgeTags.push(tags.speaker(p));
	}
	purgeTags.push(tags.listSpeakers);

	return { r2Keys: Array.from(r2Keys), tags: purgeTags };
}

/**
 * Compute R2 origin keys and Workers Cache tags to invalidate after list page
 * content changes.
 *
 * Faithfully mirrors `invalidateListPageCaches` from `upload_markdown.ts`:
 * - R2 keys (deduplicated via Set):
 *   - home: `/` and `/index.html`
 *   - speeches: `/speeches`, `/speeches/`, `/rss.xml`, `/feed.xml`
 *   - speakers: `/speakers`, `/speakers/`
 * - Tags: `list:home` (home); `list:speeches` + `list:rss` (speeches);
 *   `list:speakers` (speakers).
 */
// LemmaScript annotations skipped: uses Set (not lsc-expressible); lsc skips
// this function, so ensures would be unverifiable.
export function planListInvalidation(host: string, home: boolean, speeches: boolean, speakers: boolean): CacheInvalidationOutput {
	const r2Keys = new Set<string>();

	if (home) {
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/index.html`);
	}
	if (speeches) {
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speeches`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speeches/`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/rss.xml`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/feed.xml`);
	}
	if (speakers) {
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speakers`);
		r2Keys.add(`${CACHE_KEY_VERSION}/${host}/speakers/`);
	}

	const purgeTags: string[] = [];
	if (home) purgeTags.push(tags.listHome);
	if (speeches) purgeTags.push(tags.listSpeeches, tags.listRss);
	if (speakers) purgeTags.push(tags.listSpeakers);

	return { r2Keys: Array.from(r2Keys), tags: purgeTags };
}

/**
 * Pure dispatcher: compute R2 origin keys and Workers Cache tags to invalidate
 * for any of the three cache-invalidation call shapes. No I/O — caller performs
 * the actual R2 deletes and Workers Cache purges.
 */
export function planCacheInvalidation(input: CacheInvalidationInput): CacheInvalidationOutput {
	switch (input.kind) {
		case 'speech':
			return planSpeechInvalidation(input.host, input.filename, input.sectionIds);
		case 'speaker':
			return planSpeakerInvalidation(input.host, input.routePathnames);
		case 'list':
			return planListInvalidation(input.host, input.home, input.speeches, input.speakers);
	}
}
