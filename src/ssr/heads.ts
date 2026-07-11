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

const baseOgTitle = 'SayIt';
const baseOgDescription = 'Transcripts for the modern internet';
const defaultOgImage = 'https://archive.tw/static/speeches/img/apple-touch-icon-152x152.png';

const og = (content: string): MetaEntry => ({ property: 'og:title', content });
const ogDescription = (content: string): MetaEntry => ({ property: 'og:description', content });

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
	return { title: ' Home :: SayIt ', meta: [og(baseOgTitle), ogDescription(baseOgDescription), ...defaultImageMeta()] };
}

export function headForPrivacy(): HeadSpec {
	return {
		title: ' Privacy Policy :: SayIt ',
		meta: [og('Privacy Policy'), ogDescription('Privacy policy for AI questions on SayIt.'), ...defaultImageMeta()],
	};
}

export function headForTerms(): HeadSpec {
	return {
		title: ' Terms of Use :: SayIt ',
		meta: [og('Terms of Use'), ogDescription('Terms of use for AI questions on SayIt.'), ...defaultImageMeta()],
	};
}

export function headForSpeakers(): HeadSpec {
	return { title: ' All Speakers :: SayIt ', meta: [og(baseOgTitle), ogDescription(baseOgDescription), ...defaultImageMeta()] };
}

export function headForSpeeches(): HeadSpec {
	return { title: ' Speeches :: Sayit ', meta: [og(baseOgTitle), ogDescription(baseOgDescription), ...defaultImageMeta()] };
}

export function headForSearch(query: string): HeadSpec {
	const safeQuery = query?.trim() || 'Search';
	return {
		title: ` Search: ${safeQuery} :: SayIt `,
		meta: [og(`Search: ${safeQuery} :: SayIt`), ogDescription(baseOgDescription), ...defaultImageMeta()],
	};
}

export function headForSingleSpeech(displayName: string, filename: string): HeadSpec {
	const name = displayName ?? '';
	return {
		title: ` View Section: ${name} :: SayIt `,
		meta: [og(`View Section: ${name} :: SayIt`), ogDescription(baseOgDescription), ...speechImageMeta(filename)],
	};
}

export function headForSpeaker(routePathname: string): HeadSpec {
	const decoded = decodeURIComponent(routePathname ?? '');
	const cleaned = decoded.replace(/-\d+$/, '').replace(/\s+/g, ' ').trim();
	return {
		title: ` View Speaker: ${cleaned} :: SayIt `,
		meta: [og(`View Speaker: ${cleaned} :: SayIt`), ogDescription(baseOgDescription), ...defaultImageMeta()],
	};
}

export function headForSpeechContent(titleText: string, sectionId: number, sectionHtml?: string): HeadSpec {
	const safeTitle = titleText ?? '';
	const descText = sectionHtml ? toPlainText(sectionHtml) : '';
	const ogImageUrl = `https://archive.tw/og/speech/${sectionId}.png`;
	const meta: MetaEntry[] = [
		og(`${safeTitle} :: SayIt`),
		{ property: 'og:image', content: ogImageUrl },
		{ property: 'og:image:width', content: '1200' },
		{ property: 'og:image:height', content: '630' },
		{ name: 'twitter:card', content: 'summary_large_image' },
	];
	if (descText) {
		meta.push(ogDescription(descText));
	}
	return {
		title: `${safeTitle} :: SayIt `,
		meta,
	};
}

export function headForNestedSpeech(displayName: string, filename: string): HeadSpec {
	const name = displayName ?? '';
	return {
		title: ` View Section: ${name} :: SayIt `,
		meta: [og(`View Section: ${name} :: SayIt`), ogDescription(baseOgDescription), ...speechImageMeta(filename)],
	};
}

export function headForNestedSpeechDetail(nestDisplayName: string, filename: string): HeadSpec {
	const name = nestDisplayName ?? '';
	return {
		title: ` View Section: ${name} :: SayIt `,
		meta: [og(`View Section: ${name} :: SayIt`), ogDescription(baseOgDescription), ...speechImageMeta(filename)],
	};
}
