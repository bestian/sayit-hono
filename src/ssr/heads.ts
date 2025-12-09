export type MetaEntry = {
	property?: string;
	name?: string;
	content: string;
};

export type HeadSpec = {
	title: string;
	meta?: MetaEntry[];
};

export function headForHome(): HeadSpec {
	return {
		title: ' Home :: SayIt ',
		meta: [
			{
				property: 'og:title',
				content: 'SayIt'
			}
		]
	};
}

export function headForSpeeches(): HeadSpec {
	return {
		title: ' Speeches :: Sayit ',
		meta: [
			{
				property: 'og:title',
				content: 'SayIt'
			}
		]
	};
}

export function headForSingleSpeech(displayName: string): HeadSpec {
	const name = displayName ?? '';
	return {
		title: ` View Section: ${name} :: SayIt `,
		meta: [
			{
				property: 'og:title',
				content: `View Section: ${name} :: SayIt`
			}
		]
	};
}

