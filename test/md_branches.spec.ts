import { describe, expect, it } from 'vitest';
import { __test__, serveMdByKey } from '../src/api/md';
import type { Context } from 'hono';
import type { ApiEnv } from '../src/api/types';

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

function createC(overrides: Partial<{ method: string; url: string; origin: string | null }> = {}) {
	return {
		req: {
			method: overrides.method ?? 'GET',
			url: overrides.url ?? 'https://example.com/api/md/demo.md',
			header: (k: string) => (k === 'Origin' ? (overrides.origin ?? null) : null),
		},
		env: {
			SPEECH_CACHE: {
				get: async () => null,
				put: async () => {},
				delete: async () => true,
			},
			DB: {
				prepare: () => ({
					bind: () => ({ first: async () => null, all: async () => ({ success: true, results: [] }) }),
					first: async () => null,
					all: async () => ({ success: true, results: [] }),
				}),
			},
		},
		text: (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers }),
	} as unknown as Context<ApiEnv>;
}

describe('serveMdByKey guards', () => {
	it('returns 404 for an empty object key', async () => {
		const res = await serveMdByKey(createC(), '');
		expect(res.status).toBe(404);
	});

	it('returns 404 for a key without .md extension', async () => {
		const res = await serveMdByKey(createC(), 'bad-key');
		expect(res.status).toBe(404);
	});

	it('returns 404 when the .an source resolves to no content', async () => {
		const res = await serveMdByKey(createC(), 'unknown.md');
		expect(res.status).toBe(404);
	});
});
