import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { renderHtml } from '../src/ssr/render';

const Empty = defineComponent({
	render: () => h('div', 'x')
});

describe('renderHtml branches', () => {
	it('uses default title when head.title and title are both missing', async () => {
		const html = await renderHtml(Empty, {});
		expect(html).toContain('<title>SayIt</title>');
	});

	it('uses explicit title override when head is missing', async () => {
		const html = await renderHtml(Empty, { title: 'MyPage' });
		expect(html).toContain('<title>MyPage :: SayIt</title>');
	});

	it('renders meta name entries and link entries with hreflang', async () => {
		const html = await renderHtml(Empty, {
			head: {
				title: 'HeadTitle',
				meta: [
					{ property: 'og:title', content: 'Property Meta' },
					{ name: 'twitter:card', content: 'summary' },
					{ content: 'ignored' } as any
				],
				links: [
					{ rel: 'alternate', href: 'https://archive.tw/en', hreflang: 'en' },
					{ rel: 'alternate', href: 'https://archive.tw/zh' }
				]
			}
		});
		expect(html).toContain('<meta property="og:title" content="Property Meta">');
		expect(html).toContain('<meta name="twitter:card" content="summary">');
		expect(html).not.toContain('ignored');
		expect(html).toContain('hreflang="en"');
		expect(html).toContain('<link rel="alternate" href="https://archive.tw/zh">');
	});

	it('omits inline <style> block when styles are blank', async () => {
		const html = await renderHtml(Empty, { styles: '   ' });
		expect(html).not.toMatch(/<style>\s*<\/style>/);
	});

	it('includes extra scripts when provided', async () => {
		const html = await renderHtml(Empty, { scripts: '<script>window.x=1;</script>' });
		expect(html).toContain('window.x=1');
	});
});
