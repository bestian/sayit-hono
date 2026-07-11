import { describe, expect, it } from 'vitest';
import { parseRedirectsText, planRedirectDiff } from '../src/api/redirects';
import { createMockEnv, dispatch, type MockWorkerEnv } from './helpers/mockEnv';

function createRedirectsEnv(options: { existing?: Array<{ old: string; new: string }> } = {}): MockWorkerEnv {
	const existing = options.existing ?? [];
	const resolver = (sql: string) => {
		if (sql.startsWith('SELECT old_filename, new_filename FROM speech_redirects')) {
			return {
				success: true,
				results: existing.map((r) => ({ old_filename: r.old, new_filename: r.new })),
			};
		}
		throw new Error(`Unexpected query: ${sql}`);
	};
	return createMockEnv(resolver);
}

function request(env: MockWorkerEnv, init?: RequestInit<IncomingRequestCfProperties>) {
	return dispatch('/api/redirects', env, init);
}

describe('parseRedirectsText', () => {
	it('returns empty for null/empty', () => {
		expect(parseRedirectsText(null)).toEqual([]);
		expect(parseRedirectsText(undefined)).toEqual([]);
		expect(parseRedirectsText('')).toEqual([]);
	});

	it('skips comments and blank lines, parses tab-separated pairs', () => {
		const text = [
			'# this is a comment',
			'',
			'old1\tnew1',
			'  old2\tnew2  ',
			'old3\tnew3',
			'invalid-line-no-tab',
			'\t', // empty both sides
			'same\tsame', // self-loop, skipped
			'only-one-side\t', // empty new side
		].join('\n');
		expect(parseRedirectsText(text)).toEqual([
			{ old_filename: 'old1', new_filename: 'new1' },
			{ old_filename: 'old2', new_filename: 'new2' },
			{ old_filename: 'old3', new_filename: 'new3' },
		]);
	});

	it('handles CRLF line endings', () => {
		expect(parseRedirectsText('a\tb\r\nc\td\r\n')).toEqual([
			{ old_filename: 'a', new_filename: 'b' },
			{ old_filename: 'c', new_filename: 'd' },
		]);
	});
});

describe('planRedirectDiff', () => {
	it('classifies inserts, updates, and deletes', () => {
		const incoming = [
			{ old_filename: 'a', new_filename: 'a-new' },
			{ old_filename: 'b', new_filename: 'b-new' }, // unchanged
			{ old_filename: 'c', new_filename: 'c-changed' }, // updated
		];
		const existing = [
			{ old_filename: 'b', new_filename: 'b-new' },
			{ old_filename: 'c', new_filename: 'c-old' },
			{ old_filename: 'd', new_filename: 'd-new' }, // not in incoming → delete
		];
		expect(planRedirectDiff(incoming, existing)).toEqual({
			toInsert: [{ old_filename: 'a', new_filename: 'a-new' }],
			toUpdate: [{ old_filename: 'c', new_filename: 'c-changed' }],
			toDelete: ['d'],
		});
	});
});

describe('PUT /api/redirects — auth', () => {
	it('rejects missing Authorization', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, { method: 'PUT', body: '' });
		expect(res.status).toBe(400);
	});

	it('rejects non-Bearer Authorization', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, { method: 'PUT', headers: { Authorization: 'Basic xyz' }, body: '' });
		expect(res.status).toBe(400);
	});

	it('rejects unknown Bearer token', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer wrong' },
			body: '',
		});
		expect(res.status).toBe(400);
	});

	it('rejects Bearer with empty value', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer ' },
			body: '',
		});
		expect(res.status).toBe(400);
	});

	it('accepts the bestian token equally', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-bestian' },
			body: '',
		});
		expect(res.status).toBe(200);
	});
});

describe('PUT /api/redirects — JSON body', () => {
	it('rejects malformed JSON', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: '{nope',
		});
		expect(res.status).toBe(400);
	});

	it('rejects when pairs is missing or not an array', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ pairs: 'nope' }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects when a pair is not an object', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ pairs: ['not-an-object'] }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects when pair is null', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ pairs: [null] }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects when pair fields are not strings', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ pairs: [{ old: 'x', new: 1 }] }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects empty old/new', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ pairs: [{ old: '', new: 'y' }] }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects when old === new', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ pairs: [{ old: 'same', new: 'same' }] }),
		});
		expect(res.status).toBe(400);
	});

	it('accepts a valid JSON snapshot', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ pairs: [{ old: 'old1', new: 'new1' }] }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { inserted: number; updated: number; deleted: number; total: number };
		expect(json).toEqual({ inserted: 1, updated: 0, deleted: 0, total: 1 });
	});
});

describe('PUT /api/redirects — text body', () => {
	it('parses tab-separated text and applies snapshot', async () => {
		const env = createRedirectsEnv({ existing: [{ old: 'gone', new: 'somewhere' }] });
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'text/plain' },
			body: 'old1\tnew1\nold2\tnew2',
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { inserted: number; updated: number; deleted: number };
		expect(json).toEqual({ inserted: 2, updated: 0, deleted: 1, total: 2 });
		const sqls = env.__batchedStatements.map((s) => s.sql.trim().split(' ')[0]);
		expect(sqls.filter((s) => s === 'INSERT')).toHaveLength(2);
		expect(sqls.filter((s) => s === 'DELETE')).toHaveLength(1);
	});

	it('rejects duplicate old_filename within snapshot', async () => {
		const env = createRedirectsEnv();
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey' },
			body: 'a\tb\na\tc',
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain('Duplicate');
	});

	it('returns zero-counts when snapshot equals DB (idempotent re-run)', async () => {
		const env = createRedirectsEnv({
			existing: [
				{ old: 'a', new: 'b' },
				{ old: 'c', new: 'd' },
			],
		});
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey' },
			body: 'a\tb\nc\td',
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { inserted: number; updated: number; deleted: number; total: number };
		expect(json).toEqual({ inserted: 0, updated: 0, deleted: 0, total: 2 });
		expect(env.__batchedStatements).toHaveLength(0);
	});

	it('updates rows whose new_filename changed', async () => {
		const env = createRedirectsEnv({ existing: [{ old: 'a', new: 'old-target' }] });
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey' },
			body: 'a\tnew-target',
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { inserted: number; updated: number; deleted: number };
		expect(json).toEqual({ inserted: 0, updated: 1, deleted: 0, total: 1 });
		expect(env.__batchedStatements.some((s) => s.sql.startsWith('UPDATE speech_redirects'))).toBe(true);
	});
});

describe('PUT /api/redirects — DB error paths', () => {
	function envWith(prepareImpl: (sql: string) => any) {
		return {
			AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
			BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
			ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
			SPEECH_CACHE: {
				delete: async () => true,
				get: async () => null,
				put: async () => undefined,
				list: async () => ({ objects: [], truncated: false, cursor: '' }),
			},
			DB: { prepare: prepareImpl, batch: async () => [] },
		} as any;
	}

	it('503 when SELECT throws', async () => {
		const env = envWith((sql: string) => {
			if (sql.startsWith('SELECT')) throw new Error('boom');
			return { bind: () => ({ first: async () => null, all: async () => ({ success: true, results: [] }) }) };
		});
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey' },
			body: 'a\tb',
		});
		expect(res.status).toBe(503);
	});

	it('503 when SELECT reports failure', async () => {
		const env = envWith(() => ({
			bind: () => ({
				first: async () => null,
				all: async () => ({ success: false, results: [] }),
			}),
			first: async () => null,
			all: async () => ({ success: false, results: [] }),
		}));
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey' },
			body: 'a\tb',
		});
		expect(res.status).toBe(503);
	});

	it('503 when batch throws', async () => {
		const env = {
			AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
			BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
			ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
			SPEECH_CACHE: {
				delete: async () => true,
				get: async () => null,
				put: async () => undefined,
				list: async () => ({ objects: [], truncated: false, cursor: '' }),
			},
			DB: {
				prepare: (sql: string) => ({
					bind: () => ({
						sql,
						args: [],
						first: async () => null,
						all: async () => ({ success: true, results: [] }),
					}),
					first: async () => null,
					all: async () => ({ success: true, results: [] }),
				}),
				batch: async () => {
					throw new Error('batch boom');
				},
			},
		} as any;
		const { res } = await request(env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey' },
			body: 'a\tb',
		});
		expect(res.status).toBe(503);
	});
});
