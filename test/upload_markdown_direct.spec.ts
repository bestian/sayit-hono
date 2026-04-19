import { describe, expect, it } from 'vitest';
import { uploadMarkdown } from '../src/api/upload_markdown';
import type { Context } from 'hono';
import type { ApiEnv } from '../src/api/types';

function makeContext(overrides: Partial<{
	method: string;
	url: string;
	authorization: string | null;
	body: any;
	filename: string | null;
	resolver: (sql: string, args: unknown[]) => { success?: boolean; results: any[] };
	batchChanges: number[];
}> = {}) {
	const resolver = overrides.resolver ?? (() => ({ success: true, results: [] }));
	const changes = overrides.batchChanges ?? [1, 1, 1];
	const batchStatements: Array<{ sql: string; args: unknown[] }> = [];

	const db = {
		prepare: (sql: string) => {
			const run = (args: unknown[]) => ({
				sql,
				args,
				first: async () => resolver(sql, args).results[0] ?? null,
				all: async () => {
					const r = resolver(sql, args);
					return { success: r.success ?? true, results: r.results };
				},
				run: async () => ({ success: true, meta: { changes: 1 } })
			});
			return {
				bind: (...args: unknown[]) => run(args),
				first: async () => run([]).first(),
				all: async () => run([]).all(),
				run: async () => run([]).run()
			};
		},
		batch: async (stmts: any[]) => {
			for (const stmt of stmts) batchStatements.push({ sql: stmt.sql, args: stmt.args });
			return stmts.map((_, i) => ({ meta: { changes: changes[i] ?? 1 } }));
		}
	};

	return {
		batchStatements,
		ctx: {
			env: {
				AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
				BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
				SPEECH_CACHE: {
					get: async () => null,
					put: async () => {},
					delete: async () => true,
					list: async () => ({ objects: [], truncated: false, cursor: '' })
				},
				DB: db
			},
			req: {
				method: overrides.method ?? 'PUT',
				url: overrides.url ?? 'https://example.com/api/upload_markdown',
				header: (name: string) => {
					if (name === 'Authorization') return overrides.authorization ?? 'Bearer token-audrey';
					if (name === 'Origin') return null;
					return null;
				},
				query: (_: string) => overrides.filename ?? null,
				json: async () => overrides.body ?? {}
			},
			text: (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers }),
			json: (body: any, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
				status,
				headers: { 'Content-Type': 'application/json', ...headers }
			})
		} as unknown as Context<ApiEnv>
	};
}

describe('uploadMarkdown direct — unsupported method', () => {
	it('returns 400 with method-not-supported when called with PUT', async () => {
		const { ctx } = makeContext({ method: 'PUT' });
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Method not supported' });
	});

	it('returns 400 for GET (read-only verb should be rejected as unsupported)', async () => {
		const { ctx } = makeContext({ method: 'GET' });
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(400);
	});
});

describe('uploadMarkdown PATCH — orphan speech_speakers cleanup', () => {
	it('issues relation and speaker cleanup when speech_speakers lists slugs no longer in use', async () => {
		const { ctx, batchStatements } = makeContext({
			method: 'PATCH',
			body: {
				filename: 'orphan-demo',
				markdown: '# Orphan Demo\n## A:\nstill here'
			},
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_index WHERE filename = ?')) {
					if (args[0] === 'orphan-demo') {
						return { success: true, results: [{
							filename: 'orphan-demo',
							display_name: 'Orphan Demo',
							isNested: 0,
							alternate_filename: null
						}] };
					}
					return { success: true, results: [] };
				}
				if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
					return {
						success: true,
						results: [{
							section_id: 10,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'A',
							section_content: '<p>old content</p>'
						}]
					};
				}
				if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
					// Returns BOTH A (still in use) and ZOMBIE (orphan — should be cleaned up)
					return {
						success: true,
						results: [
							{ speaker_route_pathname: 'A' },
							{ speaker_route_pathname: 'ZOMBIE' }
						]
					};
				}
				if (sql.includes('SELECT DISTINCT section_speaker')) {
					return { success: true, results: [{ section_speaker: 'A' }] };
				}
				return { success: true, results: [] };
			}
		});

		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);

		const cleanupSqls = batchStatements.map((s) => s.sql).filter((sql) =>
			sql.includes('DELETE FROM speech_speakers WHERE speech_filename = ? AND speaker_route_pathname = ?')
		);
		expect(cleanupSqls.length).toBeGreaterThan(0);
		// Check that ZOMBIE is the one deleted
		const zombieCleanups = batchStatements.filter((s) =>
			s.sql.includes('DELETE FROM speech_speakers WHERE speech_filename = ? AND speaker_route_pathname = ?')
			&& s.args[1] === 'ZOMBIE'
		);
		expect(zombieCleanups.length).toBe(1);
	});
});
