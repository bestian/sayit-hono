import { describe, expect, it } from 'vitest';
import { renderHtml } from '../src/ssr/render';
import HomeView, { styles as HomeViewStyles } from '../src/.generated/views/HomeView';
import Navbar, { styles as NavbarStyles } from '../src/.generated/components/Navbar';
import Footer, { styles as FooterStyles } from '../src/.generated/components/Footer';

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
		expect(html).toContain('id="sayit-ask-submit"');
		expect(html).toContain('id="sayit-ask-answer"');
		expect(html).toContain('class="homepage-ask-answer" aria-live="polite" hidden');
	});
});
