/**
 * Consolidated text-helper functions shared across the SSR, API, and search
 * subsystems. Each export here is the single canonical copy of a helper that
 * previously existed as 2+ near-duplicate private copies; a later rewiring
 * wave replaces those local copies with imports from this module.
 *
 * Note: this is regex/JSON string logic — LemmaScript annotation is out of
 * scope (lsc cannot model RegExp or JSON.parse).
 */

/** Named HTML entities recognised by {@link decodeHtmlEntities}. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

/**
 * Parse a DB content blob: if it is a JSON string, unwrap to the inner string;
 * otherwise return the raw value as-is.
 */
export function parseContent(raw?: string | null): string {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'string' ? parsed : raw;
	} catch {
		return raw;
	}
}

/** Decode numeric (&#nn; / &#xHH;) and the six named HTML entities to characters. */
export function decodeHtmlEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity[0] === '#') {
			const isHex = entity[1]?.toLowerCase() === 'x';
			const raw = isHex ? entity.slice(2) : entity.slice(1);
			const parsed = Number.parseInt(raw, isHex ? 16 : 10);
			if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0x10ffff) {
				return match;
			}
			return String.fromCodePoint(parsed);
		}

		return NAMED_ENTITIES[entity] ?? match;
	});
}

/**
 * Strip HTML to plain text: removes style/script blocks, block-level closing
 * tags, and remaining tags, then decodes HTML entities and collapses whitespace.
 * (Fixes the prior heads.ts copy which omitted the entity-decode step.)
 */
export function toPlainText(html: string): string {
	return decodeHtmlEntities(
		html
			.replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
			.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
			.replace(/<br\s*\/?>/gi, ' ')
			.replace(/<\/(p|div|section|article|li|blockquote|h[1-6]|tr|td|th)>/gi, ' ')
			.replace(/<[^>]+>/g, ' '),
	)
		.replace(/\s+/g, ' ')
		.trim();
}

/** Escape the five HTML-significant characters (& < > " ') to their entities. */
export function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
