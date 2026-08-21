import { describe, expect, it } from 'vite-plus/test';
import { renderHtml } from '../src/ssr/render';
import HomeView, { styles as HomeViewStyles } from '../src/views/HomeView.vue';
import Navbar, { styles as NavbarStyles } from '../src/components/Navbar.vue';
import Footer, { styles as FooterStyles } from '../src/components/Footer.vue';
import SearchResultView, { styles as SearchResultViewStyles } from '../src/views/SearchResultView.vue';
import LegalPrivacyView, { styles as LegalPrivacyViewStyles } from '../src/views/LegalPrivacyView.vue';
import SingleSpeechView, { styles as SingleSpeechViewStyles } from '../src/views/SingleSpeechView.vue';

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

	it('uses the official local Justfont bootstrap without the failed legacy endpoint or unused font preload', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		expect(html).toContain('src="/static/speeches/js/justfont-loader.js"');
		expect(html).toContain('href="https://ds.justfont.com"');
		expect(html).not.toContain('s3-ap-northeast-1.amazonaws.com/justfont-user-script');
		expect(html).not.toContain('rel="preload" href="/static/fonts/source-sans-3');
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

	it('navbar share control has no legacy margin-top styling', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		expect(html).not.toContain('margin-top: 5px');
		expect(html).toContain('class="sayit-share-button"');
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
		expect(html).toContain('Search returns the record');
		expect(html).not.toContain('white-space: pre-wrap');
	});

	it('renders an explicit current interface-language control', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		const toggleMatch = html.match(/<button[^>]*id="sayit-site-lang-toggle"[^>]*>[\s\S]*?<\/button>/);
		expect(toggleMatch).not.toBeNull();
		const toggleHtml = toggleMatch![0];
		expect(toggleHtml).toContain('介面：華文');
		expect(toggleHtml).toContain('Interface: English');
		expect(toggleHtml).not.toContain('\u{1F1EC}\u{1F1E7}');
		expect(toggleHtml).not.toContain('\u{1F1F9}\u{1F1FC}');
	});

	it('renders footer ask notice with local privacy and terms links', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		expect(html).toContain('site-footer__notice');
		expect(html).toContain('href="/privacy"');
		expect(html).toContain('href="/terms"');
		expect(html).not.toContain('ask.archive.tw/privacy');
		expect(html).not.toContain('site-footer__nav');
	});

	it('renders bilingual civic.ai footer notice with CC0 attribution', async () => {
		const html = await renderHtml(HomeView, {
			styles: [HomeViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
		});

		expect(html).toContain('id="cc"');
		expect(html).toContain('Co-maintained by Audrey Tang and Bestian Tang');
		expect(html).toContain('archive is released under CC0');
		expect(html).toContain('For more information on Civic AI and 6-Pack of Care, please visit');
		expect(html).toContain('href="https://civic.ai/"');
		expect(html).toContain('本站由唐鳳與唐宗浩共同維運');
		expect(html).toContain('內容以 CC0 釋出');
		expect(html).toContain('仁工智慧');
		expect(html).toContain('關懷六力');
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
		expect(html).toContain('id="sayit-site-lang-toggle"');
	});

	it('keeps an English record visible when the interface switches to 華文', async () => {
		const html = await renderHtml(SingleSpeechView, {
			styles: [SingleSpeechViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n'),
			components: { Navbar, Footer },
			props: {
				speechName: 'english-record',
				displayName: 'English record',
				sections: [
					{
						filename: 'english-record',
						section_id: 1,
						previous_section_id: null,
						next_section_id: null,
						section_speaker: 'audrey',
						section_content: '<p>Hello from the record.</p>',
						display_name: 'English record',
						photoURL: null,
						name: 'Audrey',
					},
				],
			},
		});

		expect(html).toContain('class="speech__content record-copy" lang="en"');
		expect(html).toContain('.lang-zh .record-copy[lang="en"]');
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
