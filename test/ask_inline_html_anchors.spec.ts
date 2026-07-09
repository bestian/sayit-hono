import { describe, expect, it } from 'vitest';

// Mirrors public/static/speeches/js/pagefind-search.js ask inline rendering
// (static IIFE asset; keep logic in sync when changing either side).
function isSafeHttpUrl(value: string): boolean {
	if (/[\s"'<>]/.test(value) || /&(quot|#39|lt|gt);/i.test(value)) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function escapeHtml(str: string): string {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function extractAskInlineHtmlAnchors(text: string): {
	text: string;
	anchors: Array<{ href: string; label: string }>;
} {
	const anchors: Array<{ href: string; label: string }> = [];
	const withPlaceholders = String(text || '').replace(
		/<a\b[^>]*\bhref\s*=\s*(["'])([^"'>\s]+)\1[^>]*>([\s\S]*?)<\/a>/gi,
		(_m, _quote: string, href: string, label: string) => {
			const cleanLabel = String(label).replace(/<[^>]+>/g, '').trim() || href;
			const id = anchors.length;
			anchors.push({ href, label: cleanLabel });
			return `\u0000ASKA${id}\u0000`;
		}
	);
	return { text: withPlaceholders, anchors };
}

function renderAskInlineMarkdown(text: string): string {
	const extracted = extractAskInlineHtmlAnchors(text || '');
	let html = escapeHtml(extracted.text);
	html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label: string, href: string) => {
		if (!isSafeHttpUrl(href)) return escapeHtml(label);
		return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
	});
	html = html.replace(/\u0000ASKA(\d+)\u0000/g, (_m, id: string) => {
		const item = extracted.anchors[Number(id)];
		if (!item) return '';
		if (!isSafeHttpUrl(item.href)) return escapeHtml(item.label);
		return `<a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`;
	});
	return html;
}

describe('ask inline HTML anchors (issue #141)', () => {
	it('renders raw HTML anchors as real links', () => {
		const raw =
			'您的問題超出了資料庫的範圍，逐字稿網站連結如下：' +
			'<a href="https://archive.tw" rel="nofollow noreferrer noopener" target="_blank">https://archive.tw</a>';
		const html = renderAskInlineMarkdown(raw);
		expect(html).toContain('<a href="https://archive.tw"');
		expect(html).toContain('>https://archive.tw</a>');
		expect(html).not.toContain('&lt;a href');
	});

	it('keeps plain markdown links working', () => {
		const html = renderAskInlineMarkdown('see [archive](https://archive.tw)');
		expect(html).toBe(
			'see <a href="https://archive.tw" target="_blank" rel="noopener noreferrer">archive</a>'
		);
	});

	it('strips unsafe schemes instead of linking them', () => {
		const html = renderAskInlineMarkdown('<a href="javascript:alert(1)">x</a>');
		expect(html).toBe('x');
		expect(html).not.toContain('javascript');
	});

	it('does not let anchor labels inject markdown link targets', () => {
		const html = renderAskInlineMarkdown(
			'<a href="https://archive.tw">click](https://evil.example)</a>'
		);
		expect(html).toContain('href="https://archive.tw"');
		expect(html).not.toContain('evil.example');
		expect(html).toContain('click](https://evil.example)');
	});
});
