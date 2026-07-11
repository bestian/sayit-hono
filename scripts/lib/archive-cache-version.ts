/**
 * Live worker cache key prefix (must match og_routes SPEECH_CACHE keys).
 * Prefer GET /version over committed src/cacheKeyVersion.ts (deploy regenerates it).
 */
const VERSION_URL = process.env.ARCHIVE_VERSION_URL ?? 'https://archive.tw/version';

export async function resolveCacheKeyVersion(fallback: string): Promise<string> {
	if (process.env.CACHE_KEY_VERSION) return process.env.CACHE_KEY_VERSION;
	try {
		const res = await fetch(VERSION_URL);
		if (!res.ok) throw new Error(`${VERSION_URL} ${res.status}`);
		const body = (await res.json()) as { version: string };
		if (!body.version) throw new Error(`${VERSION_URL}: missing version`);
		return body.version;
	} catch (err) {
		console.warn(`[cache-version] live /version failed (${err}); using fallback ${fallback}`);
		return fallback;
	}
}
