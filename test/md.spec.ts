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
});
