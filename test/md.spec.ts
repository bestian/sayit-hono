import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/api/md';

describe('md conversion', () => {
	it('renders apostrophes literally when converting from .an', () => {
		const md = __test__.an2md(`<?xml version="1.0" encoding="utf-8"?>
<akomaNtoso>
  <heading>Why it&#39;s safe</heading>
  <TLCPerson id="p1" showAs="Audrey Tang"/>
  <speech by="#p1">
    <p>It&#39;s fine.</p>
    <p>Also &apos; works.</p>
  </speech>
</akomaNtoso>`);

		expect(md).toContain("# Why it's safe");
		expect(md).toContain("It's fine.");
		expect(md).toContain("Also ' works.");
		expect(md).not.toContain('&#39;');
		expect(md).not.toContain('&apos;');
	});

	it('uses fullwidth ：for speaker names ending in Han characters', () => {
		const md = __test__.an2md(`<akomaNtoso>
			<TLCPerson id="p1" showAs="唐鳳"/>
			<speech by="#p1"><p>大家好</p></speech>
		</akomaNtoso>`);
		expect(md).toContain('### 唐鳳：');
		expect(md).not.toContain('### 唐鳳: ');
	});

	it('keeps halfwidth ": " for non-Han speaker names', () => {
		const md = __test__.an2md(`<akomaNtoso>
			<TLCPerson id="p1" showAs="TonyQ"/>
			<speech by="#p1"><p>Hello</p></speech>
		</akomaNtoso>`);
		expect(md).toContain('### TonyQ: ');
	});

	it('renders Unknown speaker as blockquote without ### header', () => {
		const md = __test__.an2md(`<akomaNtoso>
			<TLCPerson id="u" showAs="Unknown"/>
			<speech by="#u"><p>（開場簡報）</p><p>連結略</p></speech>
		</akomaNtoso>`);
		expect(md).not.toContain('### Unknown');
		expect(md).toContain('> （開場簡報）');
		expect(md).toContain('> 連結略');
	});
});
