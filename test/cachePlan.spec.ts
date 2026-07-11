import { describe, expect, it } from 'vitest';
import {
	planCacheInvalidation,
	planSpeechInvalidation,
	planSpeakerInvalidation,
	planListInvalidation,
	type CacheInvalidationInput
} from '../src/utils/cachePlan';
import { CACHE_KEY_VERSION, r2AnKey, r2MdKey, r2OgSpeechKey, r2OgSectionKey, tags } from '../src/api/cache';

const HOST = 'sayit.example.com';

describe('planSpeechInvalidation', () => {
	it('produces the base 5 R2 keys + 4 tags with no section IDs', () => {
		const filename = 'my-speech';
		const out = planSpeechInvalidation(HOST, filename, []);

		expect(out.r2Keys).toEqual([
			r2AnKey(filename),
			r2MdKey(filename),
			`${CACHE_KEY_VERSION}/${HOST}/${filename}`,
			`${CACHE_KEY_VERSION}/${HOST}/${encodeURIComponent(filename)}`,
			r2OgSpeechKey(filename)
		]);
		expect(out.tags).toEqual([
			tags.speech(filename),
			tags.listHome,
			tags.listSpeeches,
			tags.listRss
		]);
	});

	it('appends 2 R2 keys (HTML + OG PNG) per section ID', () => {
		const out = planSpeechInvalidation(HOST, 'talk', [10, 20]);

		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speech/10`);
		expect(out.r2Keys).toContain(r2OgSectionKey(10));
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speech/20`);
		expect(out.r2Keys).toContain(r2OgSectionKey(20));
		expect(out.r2Keys).toHaveLength(5 + 4);
	});

	it('deduplicates and finite-filters section IDs (matching original Set behavior)', () => {
		const out = planSpeechInvalidation(HOST, 'talk', [10, 10, 20, Number.NaN, 30]);

		// NaN filtered, 10 deduplicated → unique IDs: 10, 20, 30
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speech/10`);
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speech/20`);
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speech/30`);
		expect(out.r2Keys).toHaveLength(5 + 6);
	});

	it('percent-encodes the HTML key but not the raw key (matching original)', () => {
		const filename = '台灣演講';
		const out = planSpeechInvalidation(HOST, filename, []);

		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/${filename}`);
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/${encodeURIComponent(filename)}`);
		expect(out.tags).toContain(tags.speech(filename));
	});
});

describe('planSpeakerInvalidation', () => {
	it('always includes the /speakers root key and listSpeakers tag', () => {
		const out = planSpeakerInvalidation(HOST, []);

		expect(out.r2Keys).toEqual([`${CACHE_KEY_VERSION}/${HOST}/speakers`]);
		expect(out.tags).toEqual([tags.listSpeakers]);
	});

	it('adds raw + percent-encoded speaker keys per pathname (deduplicated via Set)', () => {
		const out = planSpeakerInvalidation(HOST, ['alice', 'bob']);

		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speaker/alice`);
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speaker/${encodeURIComponent('alice')}`);
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speaker/bob`);
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speaker/${encodeURIComponent('bob')}`);
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speakers`);
		// ASCII: raw === encoded, so Set dedupes to 1 speaker key per pathname + 1 root.
		expect(out.r2Keys).toHaveLength(3);
	});

	it('deduplicates when raw and encoded forms collide', () => {
		// ASCII pathnames: raw === encoded, so each pathname contributes 1 unique key.
		const out = planSpeakerInvalidation(HOST, ['alice']);

		expect(out.r2Keys).toEqual([
			`${CACHE_KEY_VERSION}/${HOST}/speakers`,
			`${CACHE_KEY_VERSION}/${HOST}/speaker/alice`
		]);
	});

	it('preserves duplicate tags (matching original — tags are NOT deduplicated)', () => {
		const out = planSpeakerInvalidation(HOST, ['alice', 'alice']);

		expect(out.tags).toEqual([tags.speaker('alice'), tags.speaker('alice'), tags.listSpeakers]);
		expect(out.tags).toHaveLength(3);
	});

	it('handles Unicode pathnames with distinct raw + encoded keys', () => {
		const pathname = '陳水扁';
		const out = planSpeakerInvalidation(HOST, [pathname]);

		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speaker/${pathname}`);
		expect(out.r2Keys).toContain(`${CACHE_KEY_VERSION}/${HOST}/speaker/${encodeURIComponent(pathname)}`);
	});
});

describe('planListInvalidation', () => {
	it('produces empty keys and tags when all flags are false', () => {
		const out = planListInvalidation(HOST, false, false, false);

		expect(out.r2Keys).toEqual([]);
		expect(out.tags).toEqual([]);
	});

	it('home=true adds / and /index.html keys + listHome tag', () => {
		const out = planListInvalidation(HOST, true, false, false);

		expect(out.r2Keys).toEqual([
			`${CACHE_KEY_VERSION}/${HOST}/`,
			`${CACHE_KEY_VERSION}/${HOST}/index.html`
		]);
		expect(out.tags).toEqual([tags.listHome]);
	});

	it('speeches=true adds /speeches, /speeches/, /rss.xml, /feed.xml keys + listSpeeches+listRss tags', () => {
		const out = planListInvalidation(HOST, false, true, false);

		expect(out.r2Keys).toEqual([
			`${CACHE_KEY_VERSION}/${HOST}/speeches`,
			`${CACHE_KEY_VERSION}/${HOST}/speeches/`,
			`${CACHE_KEY_VERSION}/${HOST}/rss.xml`,
			`${CACHE_KEY_VERSION}/${HOST}/feed.xml`
		]);
		expect(out.tags).toEqual([tags.listSpeeches, tags.listRss]);
	});

	it('speakers=true adds /speakers and /speakers/ keys + listSpeakers tag', () => {
		const out = planListInvalidation(HOST, false, false, true);

		expect(out.r2Keys).toEqual([
			`${CACHE_KEY_VERSION}/${HOST}/speakers`,
			`${CACHE_KEY_VERSION}/${HOST}/speakers/`
		]);
		expect(out.tags).toEqual([tags.listSpeakers]);
	});

	it('all=true produces the union of all keys and tags', () => {
		const out = planListInvalidation(HOST, true, true, true);

		expect(out.r2Keys).toEqual([
			`${CACHE_KEY_VERSION}/${HOST}/`,
			`${CACHE_KEY_VERSION}/${HOST}/index.html`,
			`${CACHE_KEY_VERSION}/${HOST}/speeches`,
			`${CACHE_KEY_VERSION}/${HOST}/speeches/`,
			`${CACHE_KEY_VERSION}/${HOST}/rss.xml`,
			`${CACHE_KEY_VERSION}/${HOST}/feed.xml`,
			`${CACHE_KEY_VERSION}/${HOST}/speakers`,
			`${CACHE_KEY_VERSION}/${HOST}/speakers/`
		]);
		expect(out.tags).toEqual([
			tags.listHome,
			tags.listSpeeches,
			tags.listRss,
			tags.listSpeakers
		]);
	});
});

describe('planCacheInvalidation (dispatcher)', () => {
	it('dispatches speech shape to planSpeechInvalidation', () => {
		const input: CacheInvalidationInput = {
			kind: 'speech',
			host: HOST,
			filename: 'talk',
			sectionIds: [1]
		};
		expect(planCacheInvalidation(input)).toEqual(planSpeechInvalidation(HOST, 'talk', [1]));
	});

	it('dispatches speaker shape to planSpeakerInvalidation', () => {
		const input: CacheInvalidationInput = {
			kind: 'speaker',
			host: HOST,
			routePathnames: ['alice']
		};
		expect(planCacheInvalidation(input)).toEqual(planSpeakerInvalidation(HOST, ['alice']));
	});

	it('dispatches list shape to planListInvalidation', () => {
		const input: CacheInvalidationInput = {
			kind: 'list',
			host: HOST,
			home: true,
			speeches: false,
			speakers: false
		};
		expect(planCacheInvalidation(input)).toEqual(planListInvalidation(HOST, true, false, false));
	});
});
