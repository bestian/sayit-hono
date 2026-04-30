import type { Context } from 'hono';
import type { ApiEnv } from './types';
import { CACHE_KEY_VERSION } from '../cacheKeyVersion';

export type OgGenerators = {
	generateQuoteOgImage: (
		quoteHtml: string,
		speakerName: string | null,
		speechTitle: string,
		avatarDataUri: string | null
	) => Promise<Uint8Array>;
	generateOgImage: (
		env: { ASSETS: Fetcher },
		filename: string,
		displayName: string,
		speakers: string[]
	) => Promise<Uint8Array>;
};

export type OgLoader = () => Promise<OgGenerators>;

function parseContent(raw?: string | null): string {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'string' ? parsed : raw;
	} catch {
		return raw;
	}
}

async function loadSection(c: Context<ApiEnv>, sectionId: number) {
	return c.env.DB.prepare(
		`SELECT
			a.filename,
			a.section_speaker,
			a.section_content,
			si.display_name,
			sp.photoURL,
			sp.name
		FROM speech_content a
		LEFT JOIN speech_index si ON a.filename = si.filename
		LEFT JOIN speakers sp ON a.section_speaker = sp.route_pathname
		WHERE a.section_id = ?`
	).bind(sectionId).first() as Promise<any>;
}

async function loadSpeechMeta(c: Context<ApiEnv>, filename: string) {
	return c.env.DB.prepare(
		`SELECT filename, display_name, isNested
		 FROM speech_index WHERE filename = ?`
	).bind(filename).first() as Promise<{ filename: string; display_name: string; isNested: number | boolean } | null>;
}

async function encodeAvatar(c: Context<ApiEnv>, photoURL: string): Promise<string | null> {
	try {
		const assetUrl = new URL(photoURL, 'https://placeholder.host').pathname;
		const res = await c.env.ASSETS.fetch(new Request(`https://placeholder.host${assetUrl}`));
		if (!res.ok) return null;
		const ct = res.headers.get('content-type') || 'image/jpeg';
		const buf = new Uint8Array(await res.arrayBuffer());
		let bin = '';
		for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
		return `data:${ct};base64,${btoa(bin)}`;
	} catch (e) {
		console.error('[og/speech] avatar fetch error', e);
		return null;
	}
}

/** /og/speech/:section_id.png — OG image for a single quoted section. */
export async function handleOgSpeechImage(c: Context<ApiEnv>, loader: OgLoader) {
	const sectionId = Number((c.req.param('section_id') ?? '').replace(/\.png$/, ''));
	if (!Number.isInteger(sectionId)) return c.text('Not Found', 404);

	const cacheKey = `${CACHE_KEY_VERSION}/og/speech/${sectionId}.png`;
	const cached = await c.env.SPEECH_CACHE.get(cacheKey);
	if (cached) {
		return new Response(cached.body, {
			headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
		});
	}

	let section: any;
	try {
		section = await loadSection(c, sectionId);
	} catch (err) {
		console.error('[og/speech] DB error', err);
		return c.text('Internal Server Error', 500);
	}
	if (!section) return c.text('Not Found', 404);

	const sectionHtml = parseContent(section.section_content ?? '');
	const speakerName = section.name ?? null;
	const speechTitle = section.display_name ?? section.filename ?? '';

	try {
		const { generateQuoteOgImage } = await loader();
		const avatarDataUri = section.photoURL ? await encodeAvatar(c, section.photoURL) : null;
		const png = await generateQuoteOgImage(sectionHtml, speakerName, speechTitle, avatarDataUri);
		await c.env.SPEECH_CACHE.put(cacheKey, png, {
			httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=86400' },
		});
		return new Response(png, {
			headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
		});
	} catch (err) {
		console.error('[og/speech] generation error', err);
		return c.text('OG image generation failed', 500);
	}
}

/** /og/:filename.png — OG image for a speech page. */
export async function handleOgImage(c: Context<ApiEnv>, loader: OgLoader) {
	const pathname = new URL(c.req.url).pathname;
	const raw = pathname.replace(/^\/og\//, '').replace(/\.png$/, '');
	const filename = decodeURIComponent(raw);
	if (!filename) return c.text('Not Found', 404);

	const cacheKey = `${CACHE_KEY_VERSION}/og/${filename}.png`;
	const cached = await c.env.SPEECH_CACHE.get(cacheKey);
	if (cached) {
		return new Response(cached.body, {
			headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
		});
	}

	const speechMeta = await loadSpeechMeta(c, filename);
	if (!speechMeta) return c.text('Not Found', 404);

	let speakers: string[] = [];
	try {
		const result = await c.env.DB.prepare(
			`SELECT sp.name, MIN(sc.section_id) AS first_appearance
			 FROM speech_content sc
			 JOIN speakers sp ON sc.section_speaker = sp.route_pathname
			 WHERE sc.filename = ? AND sp.name IS NOT NULL
			 GROUP BY sp.name
			 ORDER BY first_appearance
			 LIMIT 5`
		).bind(filename).all();
		speakers = result.results.map((r: any) => r.name).filter(Boolean);
	} catch (err) {
		console.error('[og] speakers query error', err);
	}

	try {
		const { generateOgImage } = await loader();
		const png = await generateOgImage(c.env, filename, speechMeta.display_name, speakers);
		await c.env.SPEECH_CACHE.put(cacheKey, png, {
			httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=86400' },
		});
		return new Response(png, {
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'public, max-age=86400, s-maxage=86400',
			},
		});
	} catch (err) {
		console.error('[og] generation error', err);
		return c.text('OG image generation failed', 500);
	}
}
