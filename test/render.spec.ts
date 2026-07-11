import { describe, expect, it } from 'vite-plus/test';
import { renderHtml } from '../src/ssr/render';
import HomeView, { styles as HomeViewStyles } from '../src/views/HomeView.vue';
import Navbar, { styles as NavbarStyles } from '../src/components/Navbar.vue';
import Footer, { styles as FooterStyles } from '../src/components/Footer.vue';
import SearchResultView, { styles as SearchResultViewStyles } from '../src/views/SearchResultView.vue';
import LegalPrivacyView, { styles as LegalPrivacyViewStyles } from '../src/views/LegalPrivacyView.vue';

describe('SSR layout', () => {
	it('renders the global share control and share script', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		expect(html).toContain('data-sayit-share');
		expect(html).toContain('sayit-share-feedback');
		expect(html).toContain('navigator.share');
	});

	it('escapes title/meta/link values in the document head (XSS regression, see B5)', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
			head: {
				title: `"><script>alert(1)</script>`,
				meta: [
					{ property: 'og:title', content: `Quote " and <tag> & amp` },
					{ name: 'description', content: `'single' "double"` },
				],
				links: [{ rel: 'canonical', href: `https://example.com/?a=1&b="2`, hreflang: 'zh-Hant' }],
			},
		});

		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).toContain('Quote &quot; and &lt;tag&gt; &amp; amp');
		expect(html).toContain('&#39;single&#39; &quot;double&quot;');
		expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2"');
	});

	it('navbar share control has no legacy margin-top in SSR CSS', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		expect(html).not.toContain('margin-top: 5px');
		expect(html).toContain('margin: 0 !important');
	});

	it('renders the homepage Ask UI hidden by default', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		expect(html).toContain('id="sayit-site-lang-toggle"');
		expect(html).toContain('id="sayit-ask"');
		expect(html).toContain('class="homepage-ask" hidden');
		expect(html).not.toContain('id="sayit-ask-consent"');
		expect(html).toContain('id="sayit-ask-submit"');
		expect(html).toContain('class="homepage-search__row"');
		expect(html).toContain('class="homepage-ask-answer" aria-live="polite" hidden');
		expect(html.indexOf('id="sayit-ask-answer"')).toBeLessThan(html.indexOf('id="sayit-search-results"'));
		expect(html).toContain('homepage-ask-answer__table');
		expect(html).not.toContain('white-space: pre-wrap');
	});

	it('renders homepage site language toggle with emoji flag labels', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		const toggleMatch = html.match(/<button[^>]*id="sayit-site-lang-toggle"[^>]*>[\s\S]*?<\/button>/);
		expect(toggleMatch).not.toBeNull();
		const toggleHtml = toggleMatch![0];
		expect(toggleHtml).toContain('🇬🇧');
		expect(toggleHtml).toContain('🇹🇼');
	});

	it('renders footer ask notice with local privacy and terms links', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
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
				pagination_pages: [1],
			},
		});

		expect(html).not.toContain('id="sayit-ask"');
		expect(html).not.toContain('id="sayit-ask-status"');
		expect(html).toContain('id="sayit-ask-answer"');
		expect(html).toContain('class="homepage-ask-answer" aria-live="polite" hidden');
		expect(html.indexOf('id="sayit-ask-answer"')).toBeLessThan(html.indexOf('unstyled-list search-results-speakers'));
		expect(html).not.toContain('id="sayit-site-lang-toggle"');
	});

	it('renders bilingual privacy policy content', async () => {
		const html = await renderHtml(LegalPrivacyView, {
			styles: [LegalPrivacyViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		expect(html).toContain('id="privacy-zh"');
		expect(html).toContain('id="privacy-en"');
		expect(html).toContain('不會販售或交換您的個人資料');
		expect(html).toContain('We do not sell or exchange your personal data');
	});
});
