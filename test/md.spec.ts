import { describe, expect, it } from 'vite-plus/test';
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

describe('an2md paragraph extraction branches', () => {
	it('captures meaningful text that appears BEFORE a <p> block', () => {
		const an = `<akomaNtoso>
			<heading>Heading</heading>
			<TLCPerson id="p" showAs="Audrey"/>
			<speech by="#p">
				Leading text without a p
				<p>Inside paragraph</p>
			</speech>
		</akomaNtoso>`;
		const md = __test__.an2md(an);
		expect(md).toContain('Leading text without a p');
		expect(md).toContain('Inside paragraph');
	});

	it('keeps whole block when speech has no <p> tags at all', () => {
		const an = `<akomaNtoso>
			<heading>Heading</heading>
			<TLCPerson id="p" showAs="Audrey"/>
			<speech by="#p">Plain speech body with no p</speech>
		</akomaNtoso>`;
		const md = __test__.an2md(an);
		expect(md).toContain('Plain speech body with no p');
	});

	it('drops leading blocks that contain only whitespace/comments', () => {
		const an = `<akomaNtoso>
			<heading>H</heading>
			<TLCPerson id="p" showAs="A"/>
			<speech by="#p">
				<!-- comment -->
				<p>Body</p>
			</speech>
		</akomaNtoso>`;
		const md = __test__.an2md(an);
		// Comment-only before should not appear as a separate paragraph
		expect(md).not.toContain('comment');
		expect(md).toContain('Body');
	});
});
