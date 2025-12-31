export type MetaEntry = {
	property?: string;
	name?: string;
	content: string;
};

export type HeadSpec = {
	title: string;
	meta?: MetaEntry[];
};

const baseOgTitle = 'SayIt';
const baseOgDescription = 'Transcripts for the modern internet';

const og = (content: string): MetaEntry => ({ property: 'og:title', content });
const ogDescription = (content: string): MetaEntry => ({ property: 'og:description', content });

function description(content: string): MetaEntry {
	return { property: 'og:description', content };
}

function toPlainText(html: string): string {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function headForHome(): HeadSpec {
	return { title: ' Home :: SayIt ', meta: [og(baseOgTitle), ogDescription(baseOgDescription)] };
}

export function headForSpeakers(): HeadSpec {
	return { title: ' All Speakers :: SayIt ', meta: [og(baseOgTitle), ogDescription(baseOgDescription)] };
}

export function headForSpeeches(): HeadSpec {
	return { title: ' Speeches :: Sayit ', meta: [og(baseOgTitle), ogDescription(baseOgDescription)] };
}

export function headForSingleSpeech(displayName: string): HeadSpec {
	const name = displayName ?? '';
	return {
		title: ` View Section: ${name} :: SayIt `,
		meta: [og(`View Section: ${name} :: SayIt`), ogDescription(baseOgDescription)]
	};
}

export function headForSpeaker(routePathname: string): HeadSpec {
	const decoded = decodeURIComponent(routePathname ?? '');
	const cleaned = decoded.replace(/-\d+$/, '').replace(/\s+/g, ' ').trim();
	return {
		title: ` View Speaker: ${cleaned} :: SayIt `,
		meta: [og(`View Speaker: ${cleaned} :: SayIt`), ogDescription(baseOgDescription)]
	};
}

export function headForSpeechContent(titleText: string, sectionHtml?: string): HeadSpec {
	const safeTitle = titleText ?? '';
	const descText = sectionHtml ? toPlainText(sectionHtml) : '';
	const meta: MetaEntry[] = [og(`${safeTitle} :: SayIt`)];
	if (descText) {
		meta.push(description(descText));
	}
	return {
		title: `${safeTitle} :: SayIt `,
		meta
	};
}

export function headForNestedSpeech(displayName: string): HeadSpec {
	const name = displayName ?? '';
	return {
		title: ` View Section: ${name} :: SayIt `,
		meta: [og(`View Section: ${name} :: SayIt`), ogDescription(baseOgDescription)]
	};
}

export function headForNestedSpeechDetail(nestDisplayName: string): HeadSpec {
	const name = nestDisplayName ?? '';
	return {
		title: ` View Section: ${name} :: SayIt `,
		meta: [og(`View Section: ${name} :: SayIt`), ogDescription(baseOgDescription)]
	};
}
