import { describe, expect, it } from 'vite-plus/test';
import {
	headForHome,
	headForPrivacy,
	headForTerms,
	headForSpeakers,
	headForSpeeches,
	headForSearch,
	headForSingleSpeech,
	headForSpeaker,
	headForSpeechContent,
	headForNestedSpeech,
	headForNestedSpeechDetail,
} from '../src/ssr/heads';

describe('heads', () => {
	it('headForHome includes base OG tags', () => {
		const head = headForHome();
		expect(head.title).toContain('Home');
		const properties = head.meta?.map((m) => m.property);
		expect(properties).toEqual(expect.arrayContaining(['og:title', 'og:description', 'og:image']));
	});

	it('headForPrivacy/headForTerms expose legal page titles and descriptions', () => {
		const privacy = headForPrivacy();
		expect(privacy.title).toBe(' Privacy Policy :: SayIt ');
		expect(privacy.meta).toEqual(
			expect.arrayContaining([
				{ property: 'og:title', content: 'Privacy Policy' },
				{ property: 'og:description', content: 'Privacy policy for AI questions on SayIt.' },
			]),
		);
		expect(privacy.meta?.some((m) => m.property === 'og:image')).toBe(true);

		const terms = headForTerms();
		expect(terms.title).toBe(' Terms of Use :: SayIt ');
		expect(terms.meta).toEqual(
			expect.arrayContaining([
				{ property: 'og:title', content: 'Terms of Use' },
				{ property: 'og:description', content: 'Terms of use for AI questions on SayIt.' },
			]),
		);
		expect(terms.meta?.some((m) => m.property === 'og:image')).toBe(true);
	});

	it('headForSpeakers/headForSpeeches return stable titles', () => {
		expect(headForSpeakers().title).toContain('All Speakers');
		expect(headForSpeeches().title).toContain('Speeches');
	});

	it('headForSearch uses fallback title when query is empty', () => {
		expect(headForSearch('').title).toContain('Search');
		expect(headForSearch('').title).not.toContain(': ::');
		expect(headForSearch('foo').title).toContain('Search: foo');
	});

	it('headForSingleSpeech points og:image to the per-speech PNG', () => {
		const head = headForSingleSpeech('My Speech', '2026-01-01-demo');
		const image = head.meta?.find((m) => m.property === 'og:image');
		expect(image?.content).toBe('https://archive.tw/og/2026-01-01-demo.png');
		expect(head.meta?.some((m) => m.name === 'twitter:card')).toBe(true);
	});

	it('headForSpeaker decodes route pathname and strips trailing -N', () => {
		expect(headForSpeaker('%E5%94%90%E9%B3%B3-3').title).toContain('唐鳳');
		expect(headForSpeaker('%E5%94%90%E9%B3%B3-3').title).not.toContain('-3');
	});

	it('headForSpeechContent sets og:image to section PNG and adds description when provided', () => {
		const withHtml = headForSpeechContent('”Hi”', 42, '<p>Hello <b>world</b></p>');
		expect(withHtml.meta?.some((m) => m.property === 'og:image' && m.content.endsWith('/og/speech/42.png'))).toBe(true);
		expect(withHtml.meta?.some((m) => m.property === 'og:description' && m.content === 'Hello world')).toBe(true);

		const withoutHtml = headForSpeechContent('”Hi”', 42);
		expect(withoutHtml.meta?.some((m) => m.property === 'og:description')).toBe(false);
	});

	it('headForNestedSpeech and headForNestedSpeechDetail wire og:image to the parent filename', () => {
		const nest = headForNestedSpeech('Parent', '2026-02-parent');
		const detail = headForNestedSpeechDetail('Child', '2026-02-parent');
		const nestImage = nest.meta?.find((m) => m.property === 'og:image');
		const detailImage = detail.meta?.find((m) => m.property === 'og:image');
		expect(nestImage?.content).toBe('https://archive.tw/og/2026-02-parent.png');
		expect(detailImage?.content).toBe('https://archive.tw/og/2026-02-parent.png');
	});
});
