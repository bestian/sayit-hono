import { describe, expect, it } from 'vite-plus/test';
import {
	headForSearch,
	headForSingleSpeech,
	headForSpeaker,
	headForSpeechContent,
	headForNestedSpeech,
	headForNestedSpeechDetail,
} from '../src/ssr/heads';

describe('heads nullish / edge branches', () => {
	it('headForSearch trims whitespace-only queries to the default', () => {
		expect(headForSearch('   ').title).toContain('Search');
		expect(headForSearch('   ').title).not.toContain('   ');
	});

	it('headForSingleSpeech handles missing displayName gracefully', () => {
		const head = headForSingleSpeech(null, 'f');
		expect(head.title).toContain('Untitled record');
	});

	it('headForSpeaker handles empty routePathname', () => {
		const head = headForSpeaker('');
		expect(head.title).toContain('Unknown speaker');
	});

	it('headForSpeaker handles null routePathname', () => {
		const head = headForSpeaker(null);
		expect(head.title).toContain('Unknown speaker');
	});

	it('headForSpeechContent accepts null title and empty html', () => {
		const head = headForSpeechContent(null, 1, '');
		expect(head.title).toContain('Turn 1');
		expect(head.meta?.some((m) => m.property === 'og:description')).toBe(true);
	});

	it('headForNestedSpeech handles null displayName', () => {
		const head = headForNestedSpeech(null, 'f');
		expect(head.title).toContain('Untitled record');
	});

	it('headForNestedSpeechDetail handles null nestDisplayName', () => {
		const head = headForNestedSpeechDetail(null, 'f', 'child');
		expect(head.title).toContain('Untitled record');
	});
});
