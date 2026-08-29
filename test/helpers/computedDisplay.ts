/** Minimal display-cascade for SSR HTML. Enough to catch a hide rule beating a twin-button exception. */

type Probe = {
	tag: string;
	className: string;
	attrs: Record<string, string>;
};

const TWIN_PROBE: Probe = {
	tag: 'a',
	className: 'record-twin-button',
	attrs: { lang: 'en' },
};

const LANG_ZH_ROOT: Probe = {
	tag: 'html',
	className: 'lang-zh',
	attrs: {},
};

export function parseRecordTwinButton(html: string): { href: string; lang: string; label: string } | null {
	const match = html.match(/<a\b([^>]*\bclass="record-twin-button"[^>]*)>([\s\S]*?)<\/a>/);
	if (!match) return null;
	const attrs = match[1];
	const href = attrs.match(/\bhref="([^"]*)"/)?.[1];
	const lang = attrs.match(/\blang="([^"]*)"/)?.[1];
	if (href == null || lang == null) return null;
	return { href, lang, label: match[2].replace(/<[^>]+>/g, '').trim() };
}

/** Winning `display` for the English twin under `html.lang-zh`, or undefined if no display rule matches. */
export function twinDisplayUnderZhUi(html: string): string | undefined {
	return computedDisplay(html, [LANG_ZH_ROOT], TWIN_PROBE);
}

/** Drop selectors that mention `.record-twin-button` so the hide rule can be shown to match the twin. */
export function htmlWithoutTwinExceptions(html: string): string {
	return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) =>
		block
			.replace(/[^,{}]*\.record-twin-button[^,{}]*/g, '')
			.replace(/,\s*,+/g, ',')
			.replace(/,\s*\{/g, '{')
			.replace(/\{\s*,/g, '{'),
	);
}

function computedDisplay(html: string, ancestors: Probe[], element: Probe): string | undefined {
	const decls: Array<{ value: string; important: boolean; spec: number; order: number }> = [];
	let order = 0;
	const styleText = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
	for (const rule of parseRootDisplayRules(styleText)) {
		for (const selector of splitSelectors(rule.selectorList)) {
			if (!selectorMatches(selector, ancestors, element)) continue;
			decls.push({
				value: rule.value,
				important: rule.important,
				spec: specificity(selector),
				order: order++,
			});
		}
	}
	if (decls.length === 0) return undefined;
	decls.sort((a, b) => {
		if (a.important !== b.important) return a.important ? 1 : -1;
		if (a.spec !== b.spec) return a.spec - b.spec;
		return a.order - b.order;
	});
	return decls[decls.length - 1]?.value;
}

function skipBalanced(css: string, openIndex: number): number {
	let depth = 0;
	for (let i = openIndex; i < css.length; i++) {
		if (css[i] === '{') depth += 1;
		else if (css[i] === '}') {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return css.length - 1;
}

function parseRootDisplayRules(css: string): Array<{ selectorList: string; value: string; important: boolean }> {
	const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
	let root = '';
	let i = 0;
	while (i < uncommented.length) {
		if (uncommented[i] === '@') {
			const brace = uncommented.indexOf('{', i);
			if (brace < 0) break;
			i = skipBalanced(uncommented, brace) + 1;
			continue;
		}
		root += uncommented[i];
		i += 1;
	}
	const rules: Array<{ selectorList: string; value: string; important: boolean }> = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(root))) {
		const display = match[2].match(/(?:^|;)\s*display\s*:\s*([^;]+)/i);
		if (!display) continue;
		const raw = display[1].trim();
		rules.push({
			selectorList: match[1].trim(),
			value: raw.replace(/!important\s*$/i, '').trim(),
			important: /!important\s*$/i.test(raw),
		});
	}
	return rules;
}

function splitSelectors(selectorList: string): string[] {
	const parts: string[] = [];
	let buf = '';
	let depth = 0;
	for (const ch of selectorList) {
		if (ch === '[') depth += 1;
		else if (ch === ']') depth -= 1;
		else if (ch === ',' && depth === 0) {
			if (buf.trim()) parts.push(buf.trim());
			buf = '';
			continue;
		}
		buf += ch;
	}
	if (buf.trim()) parts.push(buf.trim());
	return parts;
}

function selectorMatches(selector: string, ancestors: Probe[], element: Probe): boolean {
	const compounds = selector.split(/\s+/).filter(Boolean);
	if (compounds.length === 0) return false;
	const last = compounds[compounds.length - 1];
	if (!last || !compoundMatches(last, element)) return false;
	let ancestorIndex = 0;
	for (const compound of compounds.slice(0, -1)) {
		let found = -1;
		for (let i = ancestorIndex; i < ancestors.length; i++) {
			const ancestor = ancestors[i];
			if (ancestor && compoundMatches(compound, ancestor)) {
				found = i;
				break;
			}
		}
		if (found < 0) return false;
		ancestorIndex = found + 1;
	}
	return true;
}

function compoundMatches(compound: string, probe: Probe): boolean {
	const tag = compound.match(/^[a-zA-Z][\w-]*/)?.[0];
	if (tag && tag.toLowerCase() !== probe.tag.toLowerCase()) return false;
	for (const cls of compound.matchAll(/\.([\w-]+)/g)) {
		if (cls[1] !== probe.className && !probe.className.split(/\s+/).includes(cls[1] ?? '')) return false;
	}
	const id = compound.match(/#([\w-]+)/)?.[1];
	if (id && probe.attrs.id !== id) return false;
	for (const attr of compound.matchAll(/\[([^\]]+)\]/g)) {
		const parsed = (attr[1] ?? '').match(/^([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))$/);
		if (!parsed) return false;
		if ((probe.attrs[parsed[1] ?? ''] ?? '') !== (parsed[2] ?? parsed[3] ?? parsed[4] ?? '')) return false;
	}
	return true;
}

function specificity(selector: string): number {
	const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
	const classes = selector.match(/\.[\w-]+/g)?.length ?? 0;
	const attrs = selector.match(/\[[^\]]+\]/g)?.length ?? 0;
	const elements = selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g)?.length ?? 0;
	return ids * 10_000 + (classes + attrs) * 100 + elements;
}
