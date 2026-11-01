import { describe, expect, it } from 'vite-plus/test';
import { sanitizeTranscriptHtml } from '../src/utils/sanitizeTranscriptHtml';
import { renderSpeechHtml } from '../src/utils/textUtils';

describe('transcript HTML boundary', () => {
	it('removes executable markup from existing stored sections', () => {
		const html = renderSpeechHtml(
			'<p><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">open</a><svg onload="alert(1)"><foreignObject><script>alert(1)</script></foreignObject></svg></p>',
		);
		expect(html).not.toMatch(/onerror|onload|javascript:|<script|foreignObject|alert\(1\)/i);
		expect(html).toContain('<a>open</a>');
	});

	it('keeps published video embeds and safe diagram shapes', () => {
		const html = sanitizeTranscriptHtml(
			'<div style="position: relative; padding-top: 56.25%; background-image: url(javascript:alert(1))"><iframe src="https://www.youtube-nocookie.com/embed/abc" style="position:absolute;top:0;width:100%;height:100%" loading="lazy" srcdoc="<script>alert(1)</script>"></iframe><svg viewBox="0 0 100 100"><title>Chart</title><circle cx="10" cy="10" r="5" fill="red" stroke="url(javascript:alert(1))" onload="alert(1)"/></svg></div>',
		);
		expect(html).toContain('https://www.youtube-nocookie.com/embed/abc');
		expect(html).toContain('padding-top:56.25%');
		expect(html).toContain('viewBox="0 0 100 100"');
		expect(html).toContain('<circle cx="10" cy="10" r="5" fill="red"/>');
		expect(html).not.toMatch(/background-image|srcdoc|onload|stroke|<script|alert\(1\)/i);
	});

	it('retains the dimensions of published video embeds', () => {
		const html = sanitizeTranscriptHtml(
			'<iframe width="560" height="315" src="https://customer-07bto6bf9uibrlc3.cloudflarestream.com/affd2bbbb0574a4d62a95c1f3fd43e65/iframe?defaultTextTrack=en&amp;poster=thumbnail.jpg" allowfullscreen></iframe>',
		);
		expect(html).toContain('width="560" height="315"');
		expect(html).toContain('customer-07bto6bf9uibrlc3.cloudflarestream.com');
	});

	it('rejects unapproved iframe destinations and active URI schemes', () => {
		const html = sanitizeTranscriptHtml(
			'<iframe src="https://example.org/embed"></iframe><iframe src="javascript:alert(1)"></iframe><a href="data:text/html,test">data</a><a href="/speech/1">local</a>',
		);
		expect(html).not.toContain('example.org');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('data:text');
		expect(html).toContain('href="/speech/1"');
	});

	it('keeps useful transcript formatting while discarding unsafe attributes', () => {
		const html = sanitizeTranscriptHtml(
			'<div style="position:relative; padding-top:56.25%; overflow:hidden; ignored"><iframe src="http://www.youtube.com/embed/a"></iframe><iframe src="/embed" style="width:100%; height:100%; border:0; bad-property:1" width="100%"></iframe></div><div style="background:url(javascript:alert(1))">Text</div><custom><strong>kept</strong></custom><img width="expression(1)" height="calc(100%)" src="https://example.com/a.jpg">',
		);
		expect(html).toContain('style="position:relative; padding-top:56.25%; overflow:hidden"');
		expect(html).toContain('<iframe src="/embed" style="width:100%; height:100%; border:0" width="100%"></iframe>');
		expect(html).toContain('<strong>kept</strong>');
		expect(html).toContain('src="https://example.com/a.jpg"');
		expect(html).not.toMatch(/http:\/\/www\.youtube|background|bad-property|expression|calc|<custom|alert\(1\)/);
	});

	it('keeps mail links and protects links that open a new tab', () => {
		const html = sanitizeTranscriptHtml(
			'<a href="mailto:editor@example.com" target="_blank" rel="opener">Email</a><a href="https://archive.tw/" target="_self">Home</a><a href="http://[::1" target="popup">Broken</a>',
		);
		expect(html).toContain('href="mailto:editor@example.com" target="_blank" rel="noopener noreferrer"');
		expect(html).toContain('href="https://archive.tw/" target="_self"');
		expect(html).toContain('<a>Broken</a>');
	});
});
