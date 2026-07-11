import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// Two distinct >50-char transcript names that share the first 50 chars after
// normalization, so transformFilename() truncates BOTH to the same legacy key.
const RAW_B = '2026-03-05-good-enough-gardeners-must-harness-ai-to-survive.md';
const norm = (s: string) => s.toLowerCase().replace(/\.md$/, '').replace(/：/g, '-');
const LEGACY_KEY = norm(RAW_B).slice(0, 50);
const RESISTANT_PREFIX = norm(RAW_B).slice(0, 42);

function makeEnv(query: (sql: string, args: unknown[]) => { success?: boolean; results: any[] }) {
	const operations: Array<{ sql: string; args: unknown[] }> = [];
	const env = {
		AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
		BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
		ASSETS: { fetch: () => new Response('NF', { status: 404 }) },
		SPEECH_CACHE: {
			delete: async () => true,
			get: async () => null,
			put: async () => {},
			list: async () => ({ objects: [], truncated: false, cursor: '' }),
		},
		DB: {
			prepare: (sql: string) => {
				const statement = (args: unknown[] = []): any => ({
					sql,
					args,
					bind: (...bound: unknown[]) => statement(bound),
					first: async () => query(sql, args).results[0] ?? null,
					all: async () => {
						const r = query(sql, args);
						return { success: r.success ?? true, results: r.results };
					},
					run: async () => {
						operations.push({ sql, args });
						return { success: true, meta: { changes: 1 } };
					},
				});
				return statement();
			},
			batch: async (stmts: any[]) => {
				for (const stmt of stmts) operations.push({ sql: stmt.sql, args: stmt.args ?? [] });
				return stmts.map(() => ({ meta: { changes: 1 } }));
			},
		},
		__operations: operations,
	};
	return env;
}

function deletedContentFor(env: ReturnType<typeof makeEnv>, key: string): boolean {
	return env.__operations.some((o) => typeof o.sql === 'string' && o.sql.startsWith('DELETE FROM speech_content') && o.args?.[0] === key);
}

describe('filename truncation clobber guard', () => {
	it('POST gives a collision-resistant key instead of clobbering a different-titled speech', async () => {
		const query = (sql: string, args: unknown[]) => {
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 1001 + Number(args[0] || 1) }] };
			}
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				// A DIFFERENT, already-stored speech occupies the truncated key.
				if (args[0] === LEGACY_KEY) {
					return { success: true, results: [{ filename: LEGACY_KEY, display_name: 'Gardeners — thrive' }] };
				}
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		};
		const env = makeEnv(query);

		const req = new IncomingRequest('https://example.com/api/upload_markdown', {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: RAW_B, markdown: '# Gardeners — survive\n\nthe other speech' }),
		});
		const res = await worker.fetch(req, env as any, createExecutionContext());
		expect(res.status).toBe(200);
		const body = (await res.json()) as { filename: string };

		// The incoming speech got a distinct, bounded, collision-resistant key.
		expect(body.filename).not.toBe(LEGACY_KEY);
		expect(body.filename.length).toBeLessThanOrEqual(50);
		expect(body.filename.startsWith(`${RESISTANT_PREFIX}-`)).toBe(true);
		// The incumbent speech at the legacy key was NOT deleted/clobbered.
		expect(deletedContentFor(env, LEGACY_KEY)).toBe(false);
		// speech_index INSERT used the resistant key, not the legacy one.
		const idxInsert = env.__operations.find((o) => typeof o.sql === 'string' && o.sql.startsWith('INSERT INTO speech_index'));
		expect(idxInsert?.args?.[0]).toBe(body.filename);
	});

	it('PATCH re-points to a collision-resistant key instead of editing a different-titled speech', async () => {
		const query = (sql: string, args: unknown[]) => {
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 2001 + Number(args[0] || 1) }] };
			}
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === LEGACY_KEY) {
					return {
						success: true,
						results: [{ filename: LEGACY_KEY, display_name: 'Gardeners — thrive', alternate_filename: null }],
					};
				}
				return { success: true, results: [] };
			}
			// PATCH reads old sections by filename; the resistant key has none yet.
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		};
		const env = makeEnv(query);

		const req = new IncomingRequest('https://example.com/api/upload_markdown', {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: RAW_B, markdown: '# Gardeners — survive\n\nthe other speech' }),
		});
		const res = await worker.fetch(req, env as any, createExecutionContext());
		expect(res.status).toBe(200);
		const body = (await res.json()) as { filename: string };

		expect(body.filename).not.toBe(LEGACY_KEY);
		expect(body.filename.startsWith(`${RESISTANT_PREFIX}-`)).toBe(true);
		// The incumbent at the legacy key was not touched as the PATCH target.
		expect(deletedContentFor(env, LEGACY_KEY)).toBe(false);
		const idxInsert = env.__operations.find((o) => typeof o.sql === 'string' && o.sql.startsWith('INSERT INTO speech_index'));
		// PATCH auto-creates the speech_index row at the resistant key.
		expect(idxInsert?.args?.[0]).toBe(body.filename);
	});
});
