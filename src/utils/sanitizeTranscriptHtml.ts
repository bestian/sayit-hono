import { load } from 'cheerio/slim';

/** The small HTML vocabulary used by transcript Markdown and published embeds. */
const ALLOWED_TAGS = new Set([
	'p',
	'br',
	'hr',
	'blockquote',
	'ul',
	'ol',
	'li',
	'a',
	'strong',
	'em',
	'b',
	'i',
	's',
	'del',
	'code',
	'pre',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'span',
	'div',
	'img',
	'iframe',
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
	'sup',
	'sub',
	'ruby',
	'rt',
	'rp',
	'figure',
	'figcaption',
	'video',
	'audio',
	'source',
	// Inline diagrams may be stored in older records. Avoid SVG animation,
	// external references, and foreignObject.
	'svg',
	'title',
	'desc',
	'g',
	'rect',
	'circle',
	'ellipse',
	'line',
	'path',
	'polyline',
	'polygon',
	'text',
	'tspan',
]);

const DROP_WITH_CONTENT = new Set([
	'script',
	'style',
	'template',
	'noscript',
	'form',
	'object',
	'embed',
	'applet',
	'foreignobject',
	'math',
	'meta',
	'link',
	'base',
]);

const EMBED_HOSTS = new Set([
	'www.youtube.com',
	'www.youtube-nocookie.com',
	'customer-07bto6bf9uibrlc3.cloudflarestream.com',
	'embed.vhx.tv',
]);

const GLOBAL_ATTRIBUTES = new Set(['class', 'lang', 'title']);
const ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(['href', 'target', 'rel']),
	img: new Set(['src', 'alt', 'width', 'height', 'loading']),
	iframe: new Set(['src', 'width', 'height', 'loading', 'allow', 'allowfullscreen', 'frameborder', 'referrerpolicy', 'style']),
	div: new Set(['style']),
	video: new Set(['src', 'controls', 'poster', 'width', 'height', 'preload']),
	audio: new Set(['src', 'controls', 'preload']),
	source: new Set(['src', 'type']),
	th: new Set(['scope', 'colspan', 'rowspan']),
	td: new Set(['colspan', 'rowspan']),
	svg: new Set(['viewbox', 'xmlns', 'width', 'height', 'role']),
	g: new Set(['fill', 'stroke', 'stroke-width', 'transform']),
	rect: new Set(['x', 'y', 'rx', 'ry', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'transform']),
	circle: new Set(['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'transform']),
	ellipse: new Set(['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'transform']),
	line: new Set(['x1', 'x2', 'y1', 'y2', 'fill', 'stroke', 'stroke-width', 'transform']),
	path: new Set(['d', 'fill', 'stroke', 'stroke-width', 'transform']),
	polyline: new Set(['points', 'fill', 'stroke', 'stroke-width', 'transform']),
	polygon: new Set(['points', 'fill', 'stroke', 'stroke-width', 'transform']),
	text: new Set(['x', 'y', 'fill', 'font-size', 'text-anchor', 'transform']),
	tspan: new Set(['x', 'y', 'dx', 'dy', 'fill', 'font-size']),
};

const SAFE_CSS_LENGTH = /^(?:0|\d+(?:\.\d+)?(?:px|%))$/;
const SAFE_HTML_LENGTH = /^\d+(?:\.\d+)?(?:px|%)?$/;
const SAFE_SVG_PAINT = /^(?:none|currentcolor|transparent|#[0-9a-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d.,%\s]+\))$/i;
const SAFE_STYLE_VALUES: Record<string, RegExp> = {
	position: /^(?:relative|absolute)$/,
	'padding-top': SAFE_CSS_LENGTH,
	top: SAFE_CSS_LENGTH,
	left: SAFE_CSS_LENGTH,
	right: SAFE_CSS_LENGTH,
	bottom: SAFE_CSS_LENGTH,
	width: SAFE_CSS_LENGTH,
	height: SAFE_CSS_LENGTH,
	border: /^(?:0|none)$/,
	overflow: /^hidden$/,
};

function safeStyle(raw: string, tag: string): string {
	const allowed =
		tag === 'div'
			? new Set(['position', 'padding-top', 'overflow'])
			: new Set(['position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'border']);
	const declarations: string[] = [];
	for (const part of raw.split(';')) {
		const colon = part.indexOf(':');
		if (colon < 0) continue;
		const key = part.slice(0, colon).trim().toLowerCase();
		const value = part
			.slice(colon + 1)
			.trim()
			.toLowerCase();
		if (allowed.has(key) && SAFE_STYLE_VALUES[key].test(value)) declarations.push(`${key}:${value}`);
	}
	return declarations.join('; ');
}

function safeUrl(raw: string, tag: string, attr: string): boolean {
	if (tag === 'img' && attr === 'src' && /^data:image\/(?:webp|png|jpe?g|gif|avif);base64,[a-z0-9+/]+={0,2}$/i.test(raw)) return true;
	try {
		const parsed = new URL(raw, 'https://archive.tw/');
		if (tag === 'a' && attr === 'href' && parsed.protocol === 'mailto:') return true;
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
		if (tag === 'iframe') {
			if (parsed.protocol !== 'https:') return false;
			// Relative embeds are retained for older transcript records and local
			// previews; external embeds are limited to the publishing providers.
			return parsed.origin === 'https://archive.tw' || EMBED_HOSTS.has(parsed.hostname);
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Parse and reserialize fragments instead of matching hostile HTML with a
 * regex. This runs during import and again when rendering preexisting DB data.
 */
export function sanitizeTranscriptHtml(html: string): string {
	const $ = load(html, { xml: { xmlMode: false, encodeEntities: 'utf8' } }, false);
	for (const element of $.root().find('*').toArray().reverse()) {
		const tag = element.name.toLowerCase();
		if (!ALLOWED_TAGS.has(tag)) {
			if (DROP_WITH_CONTENT.has(tag)) $(element).remove();
			else $(element).replaceWith($(element).contents());
			continue;
		}
		for (const [name, rawValue] of Object.entries(element.attribs)) {
			const key = name.toLowerCase();
			if (!GLOBAL_ATTRIBUTES.has(key) && !ATTRIBUTES[tag]?.has(key)) {
				$(element).removeAttr(name);
				continue;
			}
			if (key === 'style') {
				const style = safeStyle(rawValue, tag);
				if (style) $(element).attr(name, style);
				else $(element).removeAttr(name);
			} else if ((key === 'href' || key === 'src' || key === 'poster') && !safeUrl(rawValue, tag, key)) {
				$(element).removeAttr(name);
			} else if ((key === 'width' || key === 'height') && !SAFE_HTML_LENGTH.test(rawValue)) {
				$(element).removeAttr(name);
			} else if ((key === 'fill' || key === 'stroke') && !SAFE_SVG_PAINT.test(rawValue)) {
				$(element).removeAttr(name);
			} else if (key === 'target' && rawValue !== '_blank' && rawValue !== '_self') {
				$(element).removeAttr(name);
			}
		}
		if (tag === 'iframe' && !$(element).attr('src')) {
			$(element).remove();
		} else if (tag === 'a' && $(element).attr('target') === '_blank') {
			$(element).attr('rel', 'noopener noreferrer');
		}
	}
	return $.root().html() || '';
}
