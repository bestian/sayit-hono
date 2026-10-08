import { describe, expect, it } from 'vite-plus/test';
import { plainTitleText, renderTitleHtml } from '../src/utils/textUtils';

describe('renderTitleHtml', () => {
	it('leaves plain titles untouched apart from escaping', () => {
		expect(renderTitleHtml(' Oxford Discussion — Audrey Tang on Civic AI')).toBe(' Oxford Discussion — Audrey Tang on Civic AI');
		expect(renderTitleHtml('a <b> & "q"')).toBe('a &lt;b&gt; &amp; &quot;q&quot;');
	});
	it('linkifies one inline Markdown link', () => {
		expect(renderTitleHtml(' Oxford Discussion — Audrey Tang on [Civic AI](https://civic.ai)')).toBe(
			' Oxford Discussion — Audrey Tang on <a href="https://civic.ai">Civic AI</a>',
		);
	});
	it('linkifies multiple links', () => {
		expect(renderTitleHtml('[a](https://a.example/) and [b](http://b.example/x)')).toBe(
			'<a href="https://a.example/">a</a> and <a href="http://b.example/x">b</a>',
		);
	});
	it('keeps non-http destinations as literal text', () => {
		expect(renderTitleHtml('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
		expect(renderTitleHtml('[x](/relative/path)')).toBe('[x](/relative/path)');
	});
	it('escapes HTML inside labels and URLs', () => {
		expect(renderTitleHtml('[a<b](https://x.example/?p="q"&r=1)')).toBe('<a href="https://x.example/?p=&quot;q&quot;&amp;r=1">a&lt;b</a>');
	});
});

describe('plainTitleText', () => {
	it('leaves plain titles untouched', () => {
		expect(plainTitleText(' Oxford Discussion — Audrey Tang on Civic AI')).toBe(' Oxford Discussion — Audrey Tang on Civic AI');
	});
	it('collapses inline Markdown links to their labels', () => {
		expect(plainTitleText(' Oxford Discussion — Audrey Tang on [Civic AI](https://civic.ai)')).toBe(
			' Oxford Discussion — Audrey Tang on Civic AI',
		);
		expect(plainTitleText('[a](https://a.example/) and [b](http://b.example/x)')).toBe('a and b');
	});
	it('keeps non-http destinations as literal text', () => {
		expect(plainTitleText('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
		expect(plainTitleText('[x](/relative/path)')).toBe('[x](/relative/path)');
	});
});
