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

const og = (content: string): MetaEntry => ({ property: 'og:title', content });

function description(content: string): MetaEntry {
	return { property: 'og:description', content };
}

function toPlainText(html: string): string {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function headForHome(): HeadSpec {
	return { title: ' Home :: SayIt ', meta: [og(baseOgTitle)] };
}

export function headForSpeakers(): HeadSpec {
	return { title: ' All Speakers :: SayIt ', meta: [og(baseOgTitle)] };
}

export function headForSpeeches(): HeadSpec {
	return { title: ' Speeches :: Sayit ', meta: [og(baseOgTitle)] };
}

export function headForSingleSpeech(displayName: string): HeadSpec {
	const name = displayName ?? '';
	return {
		title: ` View Section: ${name} :: SayIt `,
		meta: [og(`View Section: ${name} :: SayIt`)]
	};
}

export function headForSpeaker(routePathname: string): HeadSpec {
	const decoded = decodeURIComponent(routePathname ?? '');
	const cleaned = decoded.replace(/-\d+$/, '');
	return {
		title: ` View Speaker: ${cleaned} :: SayIt `,
		meta: [og(`View Speaker: ${cleaned} :: SayIt`)]
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
