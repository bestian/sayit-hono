import { toPlainText } from '../utils/textUtils';
export type MetaEntry = {
	property?: string;
	name?: string;
	content: string;
};

export type LinkEntry = {
	rel: string;
	href: string;
	hreflang?: string;
};

export type HeadSpec = {
	title: string;
	meta?: MetaEntry[];
	links?: LinkEntry[];
};

const baseOgTitle = 'SayIt — Public speech archive';
const baseOgDescription = 'A bilingual public archive of exact words, speakers, and transcript turns.';
const defaultOgImage = 'https://archive.tw/static/speeches/img/apple-touch-icon-152x152.png';
const siteUrl = (path: string): string => `https://archive.tw${path}`;
const pageUrl = (path: string): MetaEntry => ({ property: 'og:url', content: siteUrl(path) });
const canonical = (path: string): LinkEntry[] => [{ rel: 'canonical', href: siteUrl(path) }];

const og = (content: string): MetaEntry => ({ property: 'og:title', content });
const ogDescription = (content: string): MetaEntry => ({ property: 'og:description', content });
const description = (content: string): MetaEntry => ({ name: 'description', content });
const describe = (content: string): MetaEntry[] => [description(content), ogDescription(content)];

function defaultImageMeta(): MetaEntry[] {
	return [
		{ property: 'og:image', content: defaultOgImage },
		{ property: 'og:image:width', content: '152' },
		{ property: 'og:image:height', content: '152' },
	];
}

function speechImageMeta(filename: string): MetaEntry[] {
	const ogImageUrl = `https://archive.tw/og/${encodeURIComponent(filename)}.png`;
	return [
		{ property: 'og:image', content: ogImageUrl },
		{ property: 'og:image:width', content: '1200' },
		{ property: 'og:image:height', content: '630' },
		{ name: 'twitter:card', content: 'summary_large_image' },
	];
}

export function headForHome(): HeadSpec {
	return {
		title: 'SayIt — Public speech archive',
		meta: [og(baseOgTitle), ...describe(baseOgDescription), pageUrl('/'), ...defaultImageMeta()],
		links: canonical('/'),
	};
}

export function headForPrivacy(): HeadSpec {
	return {
		title: 'Privacy Policy — SayIt',
		meta: [
			og('Privacy Policy — SayIt'),
			...describe('How Ask archive handles questions, security data, and personal information.'),
			pageUrl('/privacy'),
			...defaultImageMeta(),
		],
		links: canonical('/privacy'),
	};
}

export function headForTerms(): HeadSpec {
	return {
		title: 'Terms of Use — SayIt',
		meta: [
			og('Terms of Use — SayIt'),
			...describe('Terms for searching the public record and using AI synthesis on SayIt.'),
			pageUrl('/terms'),
			...defaultImageMeta(),
		],
		links: canonical('/terms'),
	};
}

export function headForSpeakers(): HeadSpec {
	return {
		title: 'Speaker index — SayIt',
		meta: [og('Speaker index — SayIt'), ...describe(baseOgDescription), pageUrl('/speakers/'), ...defaultImageMeta()],
		links: canonical('/speakers/'),
	};
}

export function headForSpeeches(): HeadSpec {
	return {
		title: 'Recorded conversations — SayIt',
		meta: [og('Recorded conversations — SayIt'), ...describe(baseOgDescription), pageUrl('/speeches/'), ...defaultImageMeta()],
		links: canonical('/speeches/'),
	};
}

export function headForSearch(query: string): HeadSpec {
	const safeQuery = query?.trim() || 'Search';
	return {
		title: `${safeQuery} — Search the record — SayIt`,
		meta: [
			og(`${safeQuery} — Search the record — SayIt`),
			...describe(baseOgDescription),
			pageUrl(`/search/?q=${encodeURIComponent(safeQuery)}`),
			...defaultImageMeta(),
		],
		links: canonical(`/search/?q=${encodeURIComponent(safeQuery)}`),
	};
}

export function headForSingleSpeech(displayName: string | null | undefined, filename: string): HeadSpec & { links: LinkEntry[] } {
	const name = displayName?.trim() || 'Untitled record';
	return {
		title: `${name} — SayIt`,
		meta: [
			og(`${name} — SayIt`),
			...describe(baseOgDescription),
			pageUrl(`/${encodeURIComponent(filename)}`),
			...speechImageMeta(filename),
		],
		links: canonical(`/${encodeURIComponent(filename)}`),
	};
}

export function headForSpeaker(routePathname: string | null | undefined): HeadSpec {
	const routeKey = routePathname ?? '';
	const decoded = decodeURIComponent(routeKey);
	const cleaned = decoded.replace(/-\d+$/, '').replace(/\s+/g, ' ').trim() || 'Unknown speaker';
	return {
		title: `${cleaned} — Speaker record — SayIt`,
		meta: [
			og(`${cleaned} — Speaker record — SayIt`),
			...describe(baseOgDescription),
			pageUrl(`/speaker/${encodeURIComponent(routeKey)}`),
			...defaultImageMeta(),
		],
		links: canonical(`/speaker/${encodeURIComponent(routeKey)}`),
	};
}

export function headForSpeechContent(titleText: string | null | undefined, sectionId: number, sectionHtml?: string): HeadSpec {
	const safeTitle = titleText?.trim() || `Turn ${sectionId}`;
	const pageTitle = titleText?.trim() ? `${safeTitle} — Turn ${sectionId} — SayIt` : `${safeTitle} — SayIt`;
	const descText = sectionHtml ? toPlainText(sectionHtml) : '';
	const ogImageUrl = `https://archive.tw/og/speech/${sectionId}.png`;
	const meta: MetaEntry[] = [
		og(pageTitle),
		{ property: 'og:image', content: ogImageUrl },
		{ property: 'og:image:width', content: '1200' },
		{ property: 'og:image:height', content: '630' },
		{ name: 'twitter:card', content: 'summary_large_image' },
		pageUrl(`/speech/${sectionId}`),
	];
	if (descText) {
		meta.push(...describe(descText));
	} else {
		meta.push(...describe(baseOgDescription));
	}
	return {
		title: pageTitle,
		meta,
		links: canonical(`/speech/${sectionId}`),
	};
}

export function headForNestedSpeech(displayName: string | null | undefined, filename: string): HeadSpec & { links: LinkEntry[] } {
	const name = displayName?.trim() || 'Untitled record';
	return {
		title: `${name} — SayIt`,
		meta: [
			og(`${name} — SayIt`),
			...describe(baseOgDescription),
			pageUrl(`/${encodeURIComponent(filename)}`),
			...speechImageMeta(filename),
		],
		links: canonical(`/${encodeURIComponent(filename)}`),
	};
}

export function headForNestedSpeechDetail(
	nestDisplayName: string | null | undefined,
	filename: string,
	nestFilename: string,
): HeadSpec & { links: LinkEntry[] } {
	const name = nestDisplayName?.trim() || 'Untitled record';
	const path = `/${encodeURIComponent(filename)}/${encodeURIComponent(nestFilename)}`;
	return {
		title: `${name} — SayIt`,
		meta: [og(`${name} — SayIt`), ...describe(baseOgDescription), pageUrl(path), ...speechImageMeta(filename)],
		links: canonical(path),
	};
}
