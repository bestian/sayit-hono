import { describe, expect, it } from 'vitest';
import { getAnContentAsString, isNumericAnKey, serveAnByKey, speechAn } from '../src/api/an';
import type { Context } from 'hono';
import type { ApiEnv } from '../src/api/types';

function createC(
	overrides: Partial<{
		method: string;
		url: string;
		param: string | undefined;
		path: string;
		origin: string | null;
		sectionRow: any;
		sections: any[];
	}> = {},
) {
	const sectionRow = 'sectionRow' in overrides ? overrides.sectionRow : null;
	const sections = overrides.sections ?? [];

	const db = {
		prepare: () => ({
			bind: () => ({
				first: async () => sectionRow,
				all: async () => ({ success: true, results: sections }),
			}),
			first: async () => sectionRow,
			all: async () => ({ success: true, results: sections }),
		}),
	};

	return {
		req: {
			method: overrides.method ?? 'GET',
			url: overrides.url ?? 'https://example.com/api/an/demo.an',
			path: overrides.path ?? '/api/an/demo.an',
			header: (k: string) => (k === 'Origin' ? (overrides.origin ?? null) : null),
			param: (_: string) => overrides.param,
		},
		env: {
			SPEECH_CACHE: {
				get: async () => null,
				put: async () => {},
				delete: async () => true,
			},
			DB: db,
		},
		text: (body: string, status: number = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers }),
	} as unknown as Context<ApiEnv>;
}

describe('isNumericAnKey', () => {
	it('returns true for .an files with numeric base', () => {
		expect(isNumericAnKey('123.an')).toBe(true);
		expect(isNumericAnKey('123')).toBe(true);
	});
	it('returns false for non-numeric bases', () => {
		expect(isNumericAnKey('demo.an')).toBe(false);
		expect(isNumericAnKey('2026-demo.an')).toBe(false);
	});
});

describe('serveAnByKey guards', () => {
	it('returns 404 when objectKey is empty', async () => {
		const res = await serveAnByKey(createC(), '');
		expect(res.status).toBe(404);
	});

	it('returns 404 when objectKey is missing .an extension', async () => {
		const res = await serveAnByKey(createC(), 'no-extension');
		expect(res.status).toBe(404);
	});

	it('returns 405 when method is not GET/HEAD', async () => {
		const res = await serveAnByKey(createC({ method: 'POST' }), 'demo.an');
		expect(res.status).toBe(405);
	});
});

describe('getAnContentAsString guards', () => {
	it('returns null for missing/invalid object key', async () => {
		expect(await getAnContentAsString(createC(), '')).toBeNull();
		expect(await getAnContentAsString(createC(), 'no-ext')).toBeNull();
	});

	it('returns null when section_id is not in DB', async () => {
		expect(await getAnContentAsString(createC({ sectionRow: null }), '42.an')).toBeNull();
	});

	it('returns null when full speech has no rows', async () => {
		expect(await getAnContentAsString(createC({ sections: [] }), 'demo.an')).toBeNull();
	});

	it('returns generated .an for a single section', async () => {
		const out = await getAnContentAsString(
			createC({
				sectionRow: {
					section_speaker: 'a',
					section_content: '<p>Hi</p>',
					display_name: 'Demo',
					name: 'Audrey',
				},
			}),
			'42.an',
		);
		expect(out).toContain('<heading>Demo</heading>');
	});

	it('returns generated .an for a full speech', async () => {
		const out = await getAnContentAsString(
			createC({
				sections: [{ section_speaker: 'a', section_content: '<p>Hi</p>', display_name: 'Demo', name: 'Audrey' }],
			}),
			'demo.an',
		);
		expect(out).toContain('<heading>Demo</heading>');
	});
});

describe('speechAn fallback', () => {
	it('returns 404 when path resolves to no object key (param missing and path cannot be parsed)', async () => {
		const res = await speechAn(createC({ param: undefined, path: '/api/an/', url: 'https://example.com/api/an/' }));
		expect(res.status).toBe(404);
	});

	it('decodes a valid URI-encoded path param', async () => {
		const res = await speechAn(
			createC({
				param: '%E5%94%90%E9%B3%B3.an',
				sections: [],
			}),
		);
		// No sections → 404
		expect(res.status).toBe(404);
	});

	it('tolerates a malformed URI-encoded path param by keeping it as-is', async () => {
		const res = await speechAn(
			createC({
				param: '%E0%A4%A.an',
				sections: [],
			}),
		);
		expect(res.status).toBe(404);
	});
});
