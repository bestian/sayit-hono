import type { Context } from 'hono';
import { readEdgeCache, readR2Cache, writeEdgeCache, writeR2Cache } from './cache';
import type { ApiEnv } from './types';

const SITE_URL = 'https://sayit.archive.tw';
const FEED_PATH = '/rss.xml';
const FEED_TITLE = 'SayIt';
const FEED_DESCRIPTION = 'Latest transcripts from sayit.archive.tw';
const FEED_LANGUAGE = 'zh-TW';
const FEED_LIMIT = 30;
const FEED_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
const FEED_CONTENT_TYPE = 'application/rss+xml; charset=utf-8';

type FeedRow = {
	id: number;
	filename: string;
	display_name: string;
	isNested: number | boolean;
	first_nest_filename: string | null;
	first_nest_display_name: string | null;
	first_section_content: string | null;
	first_speaker_name: string | null;
};

type FeedItem = {
	title: string;
	link: string;
	guid: string;
	description: string;
	pubDate: string | null;
};

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function decodeHtmlEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity[0] === '#') {
			const isHex = entity[1]?.toLowerCase() === 'x';
			const raw = isHex ? entity.slice(2) : entity.slice(1);
			const parsed = Number.parseInt(raw, isHex ? 16 : 10);
			if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0x10ffff) {
				return match;
			}
			return String.fromCodePoint(parsed);
		}

		return NAMED_ENTITIES[entity] ?? match;
	});
}

function toPlainText(html: string): string {
	return decodeHtmlEntities(
		html
			.replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
			.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
			.replace(/<br\s*\/?>/gi, ' ')
			.replace(/<\/(p|div|section|article|li|blockquote|h[1-6]|tr|td|th)>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
	)
		.replace(/\s+/g, ' ')
		.trim();
}

function summarizeHtml(html: string | null | undefined, maxLength = 280): string {
	const text = toPlainText(html ?? '');
	if (!text) return '';
	if (text.length <= maxLength) return text;

	const softCut = text.lastIndexOf(' ', maxLength - 1);
	const end = softCut >= Math.floor(maxLength * 0.6) ? softCut : maxLength;
	return `${text.slice(0, end).trim()}...`;
}

function parseRssDateFromFilename(filename: string): string | null {
	const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})(?:-|$)/);
	if (!match) return null;

	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const day = Number.parseInt(match[3], 10);
	const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

	if (
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month - 1 ||
		parsed.getUTCDate() !== day
	) {
		return null;
	}

	return parsed.toUTCString();
}

function buildSpeechUrl(filename: string, nestFilename?: string | null): string {
	const base = `${SITE_URL}/${encodeURIComponent(filename)}`;
	return nestFilename ? `${base}/${encodeURIComponent(nestFilename)}` : base;
}

function buildItemTitle(row: FeedRow): string {
	const displayName = row.display_name.trim();
	const nestDisplayName = row.first_nest_display_name?.trim();

	if (Boolean(row.isNested) && nestDisplayName && nestDisplayName !== displayName) {
		return `${displayName} / ${nestDisplayName}`;
	}

	return displayName;
}

function buildItemDescription(row: FeedRow): string {
	const summary = summarizeHtml(row.first_section_content);
	if (summary && row.first_speaker_name?.trim()) {
		return `${row.first_speaker_name.trim()}: ${summary}`;
	}

	return summary || FEED_DESCRIPTION;
}

function rowToFeedItem(row: FeedRow): FeedItem {
	const useNestedLink = Boolean(row.isNested) && Boolean(row.first_nest_filename);
	const link = buildSpeechUrl(row.filename, useNestedLink ? row.first_nest_filename : null);

	return {
		title: buildItemTitle(row),
		link,
		guid: link,
		description: buildItemDescription(row),
		pubDate: parseRssDateFromFilename(row.filename)
	};
}

function renderFeedXml(items: FeedItem[]): string {
	const lastBuildDate = new Date().toUTCString();
	const itemXml = items
		.map((item) => {
			const pubDate = item.pubDate ? `\n      <pubDate>${escapeXml(item.pubDate)}</pubDate>` : '';
			return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.guid)}</guid>
      <description>${escapeXml(item.description)}</description>${pubDate}
    </item>`;
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${escapeXml(SITE_URL)}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>${escapeXml(FEED_LANGUAGE)}</language>
    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
    <generator>sayit-hono</generator>
    <ttl>5</ttl>
    <atom:link href="${escapeXml(`${SITE_URL}${FEED_PATH}`)}" rel="self" type="application/rss+xml" />
${itemXml}
  </channel>
</rss>`;
}

function buildCacheKey(url: string): string {
	try {
		const u = new URL(url);
		return `${u.host}${u.pathname}${u.search}`;
	} catch {
		return url.replace(/^https?:\/\//, '');
	}
}

export async function rssFeed(c: Context<ApiEnv>) {
	const cacheKey = buildCacheKey(c.req.url);
	const edgeCached = await readEdgeCache(cacheKey);
	if (edgeCached) return edgeCached;

	const r2Cached = await readR2Cache(c.env.SPEECH_CACHE, cacheKey, FEED_CONTENT_TYPE);
	if (r2Cached) {
		await writeEdgeCache(cacheKey, r2Cached.clone(), FEED_CACHE_CONTROL);
		return r2Cached;
	}

	try {
		const result = await c.env.DB.prepare(
			`SELECT
				si.id,
				si.filename,
				si.display_name,
				si.isNested,
				(
					SELECT sc.nest_filename
					FROM speech_content sc
					WHERE sc.filename = si.filename
						AND sc.nest_filename IS NOT NULL
						AND sc.nest_filename != ''
					ORDER BY sc.section_id ASC
					LIMIT 1
				) AS first_nest_filename,
				(
					SELECT sc.nest_display_name
					FROM speech_content sc
					WHERE sc.filename = si.filename
						AND sc.nest_filename IS NOT NULL
						AND sc.nest_filename != ''
					ORDER BY sc.section_id ASC
					LIMIT 1
				) AS first_nest_display_name,
				(
					SELECT sc.section_content
					FROM speech_content sc
					WHERE sc.filename = si.filename
					ORDER BY
						CASE WHEN sc.nest_filename IS NOT NULL AND sc.nest_filename != '' THEN 0 ELSE 1 END,
						sc.section_id ASC
					LIMIT 1
				) AS first_section_content,
				(
					SELECT sp.name
					FROM speech_content sc
					LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
					WHERE sc.filename = si.filename
						AND sc.section_speaker IS NOT NULL
						AND sc.section_speaker != ''
					ORDER BY
						CASE WHEN sc.nest_filename IS NOT NULL AND sc.nest_filename != '' THEN 0 ELSE 1 END,
						sc.section_id ASC
					LIMIT 1
				) AS first_speaker_name
			FROM speech_index si
			ORDER BY si.id DESC
			LIMIT ?`
		)
			.bind(FEED_LIMIT)
			.all();

		if (!result.success) {
			return c.text('Database query failed', 500);
		}

		const items = (result.results as FeedRow[]).map((row) => rowToFeedItem(row));
		const xml = renderFeedXml(items);
		const response = new Response(xml, {
			status: 200,
			headers: {
				'Content-Type': FEED_CONTENT_TYPE,
				'Cache-Control': FEED_CACHE_CONTROL
			}
		});

		await writeR2Cache(c.env.SPEECH_CACHE, cacheKey, response.clone(), FEED_CONTENT_TYPE);
		await writeEdgeCache(cacheKey, response.clone(), FEED_CACHE_CONTROL);

		return response;
	} catch (error) {
		console.error('[rss] query failed', error);
		return c.text('Internal Server Error', 500);
	}
}
