import { describe, expect, it } from 'vitest';
import {
	headForSearch,
	headForSingleSpeech,
	headForSpeaker,
	headForSpeechContent,
	headForNestedSpeech,
	headForNestedSpeechDetail
} from '../src/ssr/heads';

describe('heads nullish / edge branches', () => {
	it('headForSearch trims whitespace-only queries to the default', () => {
		expect(headForSearch('   ').title).toContain('Search');
		expect(headForSearch('   ').title).not.toContain('   ');
	});

	it('headForSingleSpeech handles missing displayName gracefully', () => {
		const head = headForSingleSpeech(null as any, 'f');
		expect(head.title).toContain('View Section');
	});

	it('headForSpeaker handles empty routePathname', () => {
		const head = headForSpeaker('');
		expect(head.title).toContain('View Speaker');
	});

	it('headForSpeaker handles null routePathname', () => {
		const head = headForSpeaker(null as any);
		expect(head.title).toContain('View Speaker');
	});

	it('headForSpeechContent accepts null title and empty html', () => {
		const head = headForSpeechContent(null as any, 1, '');
		expect(head.title).toContain(':: SayIt');
		expect(head.meta?.some((m) => m.property === 'og:description')).toBe(false);
	});

	it('headForNestedSpeech handles null displayName', () => {
		const head = headForNestedSpeech(null as any, 'f');
		expect(head.title).toContain('View Section');
	});

	it('headForNestedSpeechDetail handles null nestDisplayName', () => {
		const head = headForNestedSpeechDetail(null as any, 'f');
		expect(head.title).toContain('View Section');
	});
});
