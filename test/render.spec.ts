import { describe, expect, it } from 'vitest';
import { renderHtml } from '../src/ssr/render';
import HomeView, { styles as HomeViewStyles } from '../src/.generated/views/HomeView';
import Navbar, { styles as NavbarStyles } from '../src/.generated/components/Navbar';
import Footer, { styles as FooterStyles } from '../src/.generated/components/Footer';
import SearchResultView, { styles as SearchResultViewStyles } from '../src/.generated/views/SearchResultView';
import LegalPrivacyView, { styles as LegalPrivacyViewStyles } from '../src/.generated/views/LegalPrivacyView';

describe('SSR layout', () => {
	it('renders the global share control and share script', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer }
		});

		expect(html).toContain('data-sayit-share');
		expect(html).toContain('sayit-share-feedback');
		expect(html).toContain('navigator.share');
	});

	it('renders the homepage Ask UI hidden by default', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer }
		});

		expect(html).toContain('id="sayit-ask"');
		expect(html).toContain('class="homepage-ask" hidden');
		expect(html).not.toContain('id="sayit-ask-consent"');
		expect(html).toContain('id="sayit-ask-submit"');
		expect(html).toContain('class="homepage-search__row"');
		expect(html).toContain('class="homepage-ask-answer" aria-live="polite" hidden');
		expect(html.indexOf('id="sayit-ask-answer"')).toBeLessThan(html.indexOf('id="sayit-search-results"'));
	});

	it('renders footer ask notice with local privacy and terms links', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer }
		});

		expect(html).toContain('sayit-footer-ask-notice');
		expect(html).toContain('href="/privacy"');
		expect(html).toContain('href="/terms"');
		expect(html).not.toContain('ask.archive.tw/privacy');
	});

	it('renders the search results page Ask UI above regular results', async () => {
		const html = await renderHtml(SearchResultView, {
			styles: [SearchResultViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
			props: {
				query: 'ochiai',
				speakers: [],
				sections: [],
				page: 1,
				page_size: 20,
				total_pages: 1,
				total_sections: 0,
				pagination_pages: [1]
			}
		});

		expect(html).toContain('id="sayit-ask"');
		expect(html).not.toContain('id="sayit-ask-consent"');
		expect(html).toContain('id="sayit-ask-status"');
		expect(html).toContain('id="sayit-ask-answer"');
		expect(html).toContain('class="homepage-ask-answer" aria-live="polite" hidden');
		expect(html.indexOf('id="sayit-ask-answer"')).toBeLessThan(html.indexOf('unstyled-list search-results-speakers'));
	});

	it('renders bilingual privacy policy content', async () => {
		const html = await renderHtml(LegalPrivacyView, {
			styles: [LegalPrivacyViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer }
		});

		expect(html).toContain('id="privacy-zh"');
		expect(html).toContain('id="privacy-en"');
		expect(html).toContain('不會販售或交換您的個人資料');
		expect(html).toContain('We do not sell or exchange your personal data');
	});
});