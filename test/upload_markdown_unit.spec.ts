/**
 * Internal-logic tests for /api/upload_markdown.
 *
 * Covers markdown parsing, section reordering/patching semantics, filename
 * collision handling, redirect creation, cache invalidation side effects,
 * and section-id reservation. Env/mock construction uses the shared
 * createMockEnv/dispatch helper from test/helpers/mockEnv.ts; per-test
 * SQL-matching resolver logic stays inline.
 *
 * Some tests call uploadMarkdown() directly (not via dispatch) to exercise
 * internal branching that is hard to reach through the HTTP layer alone.
 */
import { describe, expect, it } from 'vite-plus/test';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import { uploadMarkdown } from '../src/api/upload_markdown';
import type { Context } from 'hono';
import type { ApiEnv } from '../src/api/types';
import { createMockEnv, dispatch } from './helpers/mockEnv';
import type {
	MockD1BoundStatement,
	MockD1PreparedStatement,
	MockWorkerEnv,
	PreparedStatement,
	QueryResult,
	QueryResolver,
} from './helpers/mockEnv';
// ---------------------------------------------------------------------------
// Safe filter helper: __batchedStatements contains both bound statements
// (prepare(sql).bind(args) -> { sql, args }) and unbound prepare(sql) calls
// (no .sql property). Only filter on bound statements.
// ---------------------------------------------------------------------------

/** Returns only batched statements that have a .sql string (bound statements). */
function boundStmts(env: MockWorkerEnv): PreparedStatement[] {
	return env.__batchedStatements.filter((s): s is PreparedStatement => typeof s.sql === 'string');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpeechIndexRow = {
	filename: string;
	display_name: string;
	isNested: number;
	nest_filenames: string;
	nest_display_names: string;
	alternate_filename?: string | null;
};

// ---------------------------------------------------------------------------
// Shared resolver helpers (local to this file — domain SQL, not env shape)
// ---------------------------------------------------------------------------

function reservedCounterResult(maxSectionId: number, args: unknown[]): QueryResult {
	return { success: true, results: [{ next_id: maxSectionId + 1 + Number(args[0] || 1) }] };
}

/**
 * Builds a resolver for the "standard demo-speech" scenario: two existing
 * sections (100, 101), one speech_index row, ZOMBIE orphan speaker.
 */
function demoSpeechResolver(
	options: {
		currentAlternateFilename?: string | null;
		extraSpeechIndexRows?: SpeechIndexRow[];
	} = {},
): QueryResolver {
	const currentAlternateFilename = options.currentAlternateFilename ?? null;
	const speechIndexRows: SpeechIndexRow[] = [
		{
			filename: 'demo-speech',
			display_name: 'Demo Speech',
			isNested: 0,
			nest_filenames: '',
			nest_display_names: '',
			alternate_filename: currentAlternateFilename,
		},
		...(options.extraSpeechIndexRows ?? []),
	];
	const oldSections = [
		{
			filename: 'demo-speech',
			section_id: 100,
			previous_section_id: null,
			next_section_id: 101,
			section_speaker: null,
			section_content: '<p>Alpha</p>',
		},
		{
			filename: 'demo-speech',
			section_id: 101,
			previous_section_id: 100,
			next_section_id: null,
			section_speaker: null,
			section_content: '<p>Beta</p>',
		},
	];
	return (sql, args) => {
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) return { success: true, results: [{ count: speechIndexRows.length }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) return { success: true, results: [{ count: 0 }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) return { success: true, results: [{ count: oldSections.length }] };
		if (sql.includes('FROM speech_index WHERE filename = ?'))
			return { success: true, results: speechIndexRows.filter((row) => row.filename === args[0]) };
		if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
			const start = (oldSections[oldSections.length - 1]?.section_id ?? 0) + 1;
			return { success: true, results: [{ next_id: start + Number(args[0] || 1) }] };
		}
		if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC'))
			return { success: true, results: args[0] === 'demo-speech' ? oldSections : [] };
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
			if (args[0] === 'old-paired') return { success: true, results: [{ section_id: 99001 }] };
			if (args[0] === 'paired-speech') return { success: true, results: [{ section_id: 99002 }] };
			if (args[0] === 'fresh-speech') return { success: true, results: [{ section_id: 200 }] };
			return { success: true, results: oldSections.map(({ section_id }) => ({ section_id })) };
		}
		if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename')) {
			if (args[0] === 'fresh-speech') {
				return {
					success: true,
					results: [
						{
							filename: 'fresh-speech',
							nest_filename: null,
							section_id: 200,
							section_content: '<p>Alpha</p>',
							display_name: 'Fresh Speech',
							name: null,
						},
					],
				};
			}
			return {
				success: true,
				results: oldSections.map((section) => ({
					filename: 'demo-speech',
					nest_filename: null,
					section_id: section.section_id,
					section_content: section.section_content,
					display_name: 'Demo Speech',
					name: null,
				})),
			};
		}
		if (
			sql.includes('FROM speech_speakers WHERE speech_filename = ?') ||
			sql.includes('SELECT speaker_route_pathname FROM speech_speakers')
		) {
			if (args[0] === 'demo-speech') return { success: true, results: [{ speaker_route_pathname: 'ZOMBIE' }] };
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [] };
		if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) return { success: true, results: [] };
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename != ?')) return { success: true, results: [] };
		return { success: true, results: [] };
	};
}

/** Resolver for a single-speech scenario with configurable old sections and speaker. */
function speakerResolver(filename: string, oldSections: unknown[]): QueryResolver {
	return (sql, args) => {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			if (args[0] === filename)
				return { success: true, results: [{ filename, display_name: filename, isNested: 0, alternate_filename: null }] };
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: oldSections };
		if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
			return { success: true, results: [{ speaker_route_pathname: 'A' }] };
		if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
		if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers'))
			return { success: true, results: [{ speaker_route_pathname: 'A' }] };
		if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
			const maxSectionId = Math.max(0, ...(oldSections as Array<{ section_id: number }>).map((section) => Number(section.section_id) || 0));
			return reservedCounterResult(maxSectionId, args);
		}
		return { success: true, results: [] };
	};
}

// ---------------------------------------------------------------------------
// Direct-call helper: builds a Context for calling uploadMarkdown() directly.
// Used by tests that need to exercise internal branching via the function API
// rather than the HTTP dispatch layer.
// ---------------------------------------------------------------------------

interface DirectCallResult {
	ctx: Context<ApiEnv>;
	ops: PreparedStatement[];
	batchStatements: PreparedStatement[];
}

function makeDirectContext(
	resolver: QueryResolver,
	overrides: {
		method?: string;
		body?: unknown;
		filename?: string | null;
	} = {},
): DirectCallResult {
	const ops: PreparedStatement[] = [];
	const batchStatements: PreparedStatement[] = [];
	const ctx = {
		env: {
			AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
			BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
			SPEECH_CACHE: {
				get: async () => null,
				put: async () => {},
				delete: async () => true,
				list: async () => ({ objects: [], truncated: false, cursor: '' }),
			},
			DB: {
				prepare: (sql: string) => {
					const run = (args: unknown[]) => ({
						sql,
						args,
						first: async () => {
							const row = resolver(sql, args).results[0];
							if (row != null) return row;
							if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return { next_id: 1 + Number(args[0] || 1) };
							return null;
						},
						all: async () => {
							const r = resolver(sql, args);
							return { success: r.success ?? true, results: r.results };
						},
						run: async () => {
							ops.push({ sql, args });
							return { success: true, meta: { changes: 1 } };
						},
					});
					return {
						bind: (...args: unknown[]) => run(args),
						first: async () => run([]).first(),
						all: async () => run([]).all(),
						run: async () => run([]).run(),
					};
				},
				batch: async (stmts: PreparedStatement[]) => {
					for (const s of stmts) {
						if (typeof s.sql === 'string') batchStatements.push(s);
					}
					return stmts.map(() => ({ meta: { changes: 1 } }));
				},
			},
		},
		req: {
			method: overrides.method ?? 'PATCH',
			url: 'https://example.com/api/upload_markdown',
			header: (name: string) => (name === 'Authorization' ? 'Bearer token-audrey' : null),
			query: (_: string) => overrides.filename ?? null,
			json: async () => overrides.body ?? {},
		},
		text: (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers }),
		json: (body: unknown, status = 200, headers: Record<string, string> = {}) =>
			new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }),
	} as unknown as Context<ApiEnv>;
	return { ctx, ops, batchStatements };
}

// ---------------------------------------------------------------------------
// PATCH — section ID preservation and cache invalidation
// ---------------------------------------------------------------------------

describe('upload_markdown PATCH — section ID preservation', () => {
	it('preserves existing section IDs and invalidates the speeches list cache', async () => {
		const env = createMockEnv(demoSpeechResolver());
		const body = ['# Demo Speech', 'Alpha updated', '', 'Inserted middle', '', 'Beta'].join('\n');
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: body }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			cachePurge: true,
			searchSync: true,
			filename: 'demo-speech',
			sectionsCount: 3,
			insertedCount: 1,
			updatedCount: 2,
			deletedCount: 0,
		});
		const updateSectionIds = boundStmts(env)
			.filter((stmt) => stmt.sql.startsWith('UPDATE speech_content'))
			.map((stmt) => stmt.args[5]);
		const insertedSectionIds = boundStmts(env)
			.filter((stmt) => stmt.sql.startsWith('INSERT INTO speech_content'))
			.map((stmt) => stmt.args[3]);
		expect(updateSectionIds).toEqual([100, 101]);
		expect(insertedSectionIds).toEqual([102]);
		// R2 cache invalidation — derive from r2Store (deleted = absent)
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speeches`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speeches/`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/rss.xml`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/feed.xml`)).toBe(false);
		// R2 puts — search artifacts
		expect(env.__r2Store.get('search-updates/demo-speech.json')?.body).toContain('"v":2');
		expect(env.__r2Store.get('search-index-manifest.json')?.body).toContain('"demo-speech"');
		expect(env.__r2Store.get('stats.json')?.body).toContain('"sections"');
	});

	it('updates alternate links via PATCH without re-posting the speech', async () => {
		const env = createMockEnv(demoSpeechResolver({ currentAlternateFilename: 'old-paired' }));
		const body = ['# Demo Speech', 'Alpha', '', 'Beta'].join('\n');
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: body, alternate_filename: 'paired-speech' }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			cachePurge: true,
			searchSync: true,
			filename: 'demo-speech',
			alternate_filename: 'paired-speech',
			sectionsCount: 2,
			insertedCount: 0,
			updatedCount: 2,
			deletedCount: 0,
		});
		const speechIndexOps = boundStmts(env).filter((stmt) => stmt.sql.startsWith('UPDATE speech_index'));
		expect(speechIndexOps.map((stmt) => [stmt.sql, stmt.args])).toEqual(
			expect.arrayContaining([
				[
					'UPDATE speech_index SET display_name = ?, alternate_filename = ? WHERE filename = ?',
					['Demo Speech', 'paired-speech', 'demo-speech'],
				],
				['UPDATE speech_index SET alternate_filename = NULL WHERE filename = ? AND alternate_filename = ?', ['old-paired', 'demo-speech']],
				['UPDATE speech_index SET alternate_filename = ? WHERE filename = ?', ['demo-speech', 'paired-speech']],
			]),
		);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/demo-speech`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/old-paired`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/paired-speech`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speeches`)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// POST — alternate-language pair invalidation
// ---------------------------------------------------------------------------

describe('upload_markdown POST — alternate pair', () => {
	it('invalidates the counterpart page when creating a new alternate-language pair', async () => {
		const env = createMockEnv(
			demoSpeechResolver({
				extraSpeechIndexRows: [
					{
						filename: 'paired-speech',
						display_name: 'Paired Speech',
						isNested: 0,
						nest_filenames: '',
						nest_display_names: '',
						alternate_filename: null,
					},
				],
			}),
		);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'fresh-speech', markdown: '# Fresh Speech\nAlpha', alternate_filename: 'paired-speech' }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			cachePurge: true,
			searchSync: true,
			filename: 'fresh-speech',
			sectionsCount: 1,
			alternate_filename: 'paired-speech',
		});
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/fresh-speech`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/paired-speech`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speech/99002`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speeches`)).toBe(false);
		expect(env.__r2Store.get('search-updates/fresh-speech.json')?.body).toContain('"v":2');
		expect(env.__r2Store.get('search-index-manifest.json')?.body).toContain('"fresh-speech"');
	});
});

// ---------------------------------------------------------------------------
// PATCH — stale section cache deletion
// ---------------------------------------------------------------------------

describe('upload_markdown PATCH deletes stale section caches', () => {
	it('purges deleted section R2 keys even when they are gone from D1', async () => {
		const operations: PreparedStatement[] = [];
		let liveSections: {
			section_id: number;
			previous_section_id: number | null;
			next_section_id: number | null;
			section_speaker: string | null;
			section_content: string;
		}[] = [
			{ section_id: 100, previous_section_id: null, next_section_id: 101, section_speaker: null, section_content: '<p>Alpha</p>' },
			{ section_id: 101, previous_section_id: 100, next_section_id: null, section_speaker: null, section_content: '<p>Beta</p>' },
		];

		const resolver: QueryResolver = (sql, _args) => {
			if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) return { success: true, results: [{ count: 1 }] };
			if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) return { success: true, results: [{ count: 0 }] };
			if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) return { success: true, results: [{ count: liveSections.length }] };
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				return {
					success: true,
					results: [
						{
							filename: 'demo-speech',
							display_name: 'Demo Speech',
							isNested: 0,
							nest_filenames: '',
							nest_display_names: '',
							alternate_filename: null,
						},
					],
				};
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return { success: true, results: [{ next_id: 200 }] };
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return { success: true, results: liveSections.map((s) => ({ filename: 'demo-speech', ...s })) };
			}
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
				return { success: true, results: liveSections.map(({ section_id }) => ({ section_id })) };
			}
			if (sql.includes('FROM speech_speakers')) return { success: true, results: [] };
			if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [] };
			if (sql.includes('FROM speech_redirects')) return { success: true, results: [] };
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename != ?')) return { success: true, results: [] };
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index')) {
				return {
					success: true,
					results: liveSections.map((s) => ({
						filename: 'demo-speech',
						nest_filename: null,
						section_id: s.section_id,
						section_content: s.section_content,
						display_name: 'Demo Speech',
						name: null,
					})),
				};
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		// Override batch to simulate D1 mutations on liveSections
		env.DB.batch = async (statements: PreparedStatement[]) => {
			for (const stmt of statements) {
				operations.push(stmt);
				if (typeof stmt.sql !== 'string') continue;
				const args = stmt.args;
				if (stmt.sql.startsWith('DELETE FROM speech_content WHERE filename = ? AND section_id = ?')) {
					const id = Number(args[1]);
					liveSections = liveSections.filter((s) => s.section_id !== id);
				}
				if (stmt.sql.startsWith('UPDATE speech_content')) {
					const sectionId = Number(args[5]);
					const content = String(args[3]);
					const speaker = (args[2] as string | null) ?? null;
					const prev = (args[0] as number | null) ?? null;
					const next = (args[1] as number | null) ?? null;
					liveSections = liveSections.map((s) =>
						s.section_id === sectionId
							? {
									section_id: sectionId,
									previous_section_id: prev,
									next_section_id: next,
									section_speaker: speaker,
									section_content: content,
								}
							: s,
					);
				}
				if (stmt.sql.startsWith('INSERT INTO speech_content')) {
					liveSections.push({
						section_id: Number(args[3]),
						previous_section_id: (args[4] as number | null) ?? null,
						next_section_id: (args[5] as number | null) ?? null,
						section_speaker: (args[6] as string | null) ?? null,
						section_content: String(args[7]),
					});
				}
			}
			return statements.map(() => ({ meta: { changes: 1 } }));
		};

		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nAlpha only' }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { deletedCount: number };
		expect(body.deletedCount).toBe(1);
		// Section 101 was deleted and its R2 cache key purged
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speech/101`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/og/speech/101.png`)).toBe(false);
		// Remaining section 100 also purged
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speech/100`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/og/speech/100.png`)).toBe(false);
		// D1 view after mutation: only section 100 remains
		expect(liveSections.map((s) => s.section_id)).toEqual([100]);
	});
});

// ---------------------------------------------------------------------------
// DELETE — preexisting section cache purge
// ---------------------------------------------------------------------------

describe('upload_markdown DELETE purges preexisting section caches', () => {
	it('purges section R2 keys captured before speech_content rows are deleted', async () => {
		let liveSections = [
			{ section_id: 42, previous_section_id: null, next_section_id: null, section_speaker: null, section_content: '<p>Only</p>' },
		];
		let speechExists = true;

		const resolver: QueryResolver = (sql, _args) => {
			if (sql.includes('FROM speech_redirects')) return { success: true, results: [] };
			if (
				sql.includes('FROM speech_speakers WHERE speech_filename = ?') ||
				sql.includes('SELECT speaker_route_pathname FROM speech_speakers')
			)
				return { success: true, results: [] };
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?'))
				return { success: true, results: liveSections.map(({ section_id }) => ({ section_id })) };
			if (sql.includes('SELECT COUNT(*) AS count')) return { success: true, results: [{ count: 0 }] };
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				return {
					success: true,
					results: speechExists
						? [
								{
									filename: 'demo-speech',
									display_name: 'Demo',
									isNested: 0,
									nest_filenames: '',
									nest_display_names: '',
									alternate_filename: null,
								},
							]
						: [],
				};
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		// Override batch to simulate D1 mutations
		env.DB.batch = async (statements: PreparedStatement[]) => {
			for (const stmt of statements) {
				if (typeof stmt.sql !== 'string') continue;
				if (stmt.sql.startsWith('DELETE FROM speech_content WHERE filename = ?')) liveSections = [];
				if (stmt.sql.startsWith('DELETE FROM speech_index WHERE filename = ?')) speechExists = false;
			}
			return statements.map((stmt) => {
				const sql = typeof stmt.sql === 'string' ? stmt.sql : '';
				if (sql.startsWith('DELETE FROM speech_content')) return { meta: { changes: 1 } };
				if (sql.startsWith('DELETE FROM speech_speakers')) return { meta: { changes: 0 } };
				if (sql.startsWith('DELETE FROM speech_index')) return { meta: { changes: 1 } };
				return { meta: { changes: 0 } };
			});
		};

		const { res } = await dispatch('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(200);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speech/42`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/og/speech/42.png`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/demo-speech`)).toBe(false);
		expect(env.__r2Store.has('an/demo-speech')).toBe(false);
		expect(env.__r2Store.has('md/demo-speech')).toBe(false);
		expect(liveSections).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// invalidateSpeechCaches section query failure
// ---------------------------------------------------------------------------

describe('invalidateSpeechCaches section query failure', () => {
	it('still returns success when section_id re-query throws after PATCH', async () => {
		const env = createMockEnv(demoSpeechResolver());
		const originalPrepare = env.DB.prepare.bind(env.DB);
		env.DB.prepare = (sql: string): MockD1PreparedStatement => {
			const stmt = originalPrepare(sql);
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
				const fail = async (): Promise<never> => {
					throw new Error('section re-query failed');
				};
				return {
					bind: (..._args: unknown[]): MockD1BoundStatement => ({ sql, args: _args, first: fail, all: fail, run: fail }),
					first: fail,
					all: fail,
					run: fail,
				};
			}
			return stmt;
		};
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nAlpha\n\nBeta' }),
		});
		expect([200, 503]).toContain(res.status);
	});
});

// ---------------------------------------------------------------------------
// Defensive branches
// ---------------------------------------------------------------------------

describe('upload_markdown defensive branches', () => {
	it('covers null section_content and non-Error catch', async () => {
		// 1) PATCH with null section_content on old rows
		const env = createMockEnv(demoSpeechResolver());
		const originalPrepare = env.DB.prepare.bind(env.DB);
		env.DB.prepare = (sql: string): MockD1PreparedStatement => {
			const stmt = originalPrepare(sql);
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				const rows: QueryResult = {
					success: true,
					results: [
						{ section_id: 100, previous_section_id: null, next_section_id: 101, section_speaker: null, section_content: null },
						{ section_id: 101, previous_section_id: 100, next_section_id: null, section_speaker: null, section_content: null },
					],
				};
				return {
					bind: (..._args: unknown[]): MockD1BoundStatement => ({
						sql,
						args: _args,
						first: async () => null,
						all: async () => rows,
						run: async () => rows,
					}),
					first: async () => null,
					all: async () => ({ success: true, results: [] }),
					run: async () => ({ success: true, results: [] }),
				};
			}
			return stmt;
		};
		const ok = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nAlpha\n\nBeta' }),
		});
		expect([200, 503]).toContain(ok.res.status);

		// 2) non-Error throw path in outer catch
		const boomEnv = createMockEnv(demoSpeechResolver());
		boomEnv.DB.prepare = () => {
			throw 'string-boom';
		};
		const bad = await dispatch('/api/upload_markdown', boomEnv, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nAlpha' }),
		});
		expect(bad.res.status).toBe(503);
		const json = (await bad.res.json()) as { detail: string };
		expect(json.detail).toContain('string-boom');
	});
});

// ---------------------------------------------------------------------------
// PATCH empty result containers
// ---------------------------------------------------------------------------

describe('upload_markdown PATCH empty result containers', () => {
	it('handles undefined results arrays on PATCH load', async () => {
		const env = createMockEnv(demoSpeechResolver());
		const originalPrepare = env.DB.prepare.bind(env.DB);
		env.DB.prepare = (sql: string): MockD1PreparedStatement => {
			const stmt = originalPrepare(sql);
			// Simulates a D1 response missing `.results` entirely (downstream reads use
			// `?? []`); this exercises that defensive fallback. Single narrow cast — `results`
			// is genuinely absent at runtime, which QueryResult can't express directly.
			const missingResults = async (): Promise<QueryResult> => ({ success: true }) as QueryResult;
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return {
					bind: (): MockD1BoundStatement => ({ sql, args: [], first: async () => null, all: missingResults, run: missingResults }),
					first: async () => null,
					all: missingResults,
					run: missingResults,
				};
			}
			if (
				sql.includes('FROM speech_speakers WHERE speech_filename = ?') ||
				sql.includes('SELECT speaker_route_pathname FROM speech_speakers')
			) {
				return {
					bind: (): MockD1BoundStatement => ({ sql, args: [], first: async () => null, all: missingResults, run: missingResults }),
					first: async () => null,
					all: missingResults,
					run: missingResults,
				};
			}
			return stmt;
		};
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nOnly one section' }),
		});
		expect([200, 503]).toContain(res.status);
	});
});

// ---------------------------------------------------------------------------
// reserveSectionIds atomic reservation
// ---------------------------------------------------------------------------

describe('reserveSectionIds atomic reservation', () => {
	it('hands out disjoint id blocks across sequential POSTs', async () => {
		let counter = 100;
		let tableMax = 99;
		const idsByFilename = new Map<string, number[]>();
		const operations: PreparedStatement[] = [];

		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				const n = Number(args[0] || 1);
				counter = Math.max(counter, tableMax + 1) + n;
				return { success: true, results: [{ next_id: counter }] };
			}
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) return { success: true, results: [] };
			if (sql.includes('FROM speech_index WHERE filename = ?')) return { success: true, results: [] };
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
				return { success: true, results: (idsByFilename.get(String(args[0])) ?? []).map((section_id) => ({ section_id })) };
			}
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename'))
				return { success: true, results: [] };
			if (sql.includes('SELECT COUNT(*) AS count')) return { success: true, results: [{ count: 0 }] };
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) return { success: true, results: [] };
			if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) return { success: true, results: [] };
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		// Override batch to track INSERT ids
		env.DB.batch = async (stmts: PreparedStatement[]) => {
			for (const stmt of stmts) {
				if (typeof stmt.sql !== 'string') continue;
				operations.push({ sql: stmt.sql, args: stmt.args ?? [] });
				if (stmt.sql.startsWith('INSERT INTO speech_content')) {
					for (let i = 0; i < stmt.args.length; i += 8) {
						const filename = String(stmt.args[i]);
						const sectionId = Number(stmt.args[i + 3]);
						const ids = idsByFilename.get(filename) ?? [];
						ids.push(sectionId);
						idsByFilename.set(filename, ids);
						tableMax = Math.max(tableMax, sectionId);
					}
				}
			}
			return stmts.map(() => ({ meta: { changes: 1 } }));
		};

		const post = async (filename: string, markdown: string) =>
			dispatch('/api/upload_markdown', env, {
				method: 'POST',
				headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
				body: JSON.stringify({ filename, markdown }),
			});

		const first = await post('race-one', '# Race One\nA\n\nB');
		const second = await post('race-two', '# Race Two\nA\n\nB\n\nC');
		expect(first.res.status).toBe(200);
		expect(second.res.status).toBe(200);
		const firstIds = idsByFilename.get('race-one') ?? [];
		const secondIds = idsByFilename.get('race-two') ?? [];
		expect(firstIds).toEqual([100, 101]);
		expect(secondIds).toEqual([102, 103, 104]);
		expect(Math.min(...secondIds)).toBeGreaterThan(Math.max(...firstIds));
		expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
	});
});

// ---------------------------------------------------------------------------
// parseMarkdownSections edge branches
// ---------------------------------------------------------------------------

describe('parseMarkdownSections edge branches', () => {
	it('quote-only section gets speaker=null', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) return { success: true, results: [] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return reservedCounterResult(100, args);
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'quote-demo', markdown: '# Quote Demo\n> a blockquote line\n> second quoted line' }),
		});
		expect(res.status).toBe(200);
		const inserts = boundStmts(env).filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		expect(inserts.length).toBeGreaterThan(0);
		const hasQuoteSpeakerNull = inserts.some((ins) => ins.args[6] === null);
		expect(hasQuoteSpeakerNull).toBe(true);
	});

	it('drops empty speaker names (heading `## : ` with no name)', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) return { success: true, results: [] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return reservedCounterResult(200, args);
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'empty-speaker', markdown: '# Empty Speaker\n## :\nafter empty heading' }),
		});
		expect(res.status).toBe(200);
		const speakerInserts = boundStmts(env).filter((s) => s.sql.includes('INSERT INTO speakers'));
		expect(speakerInserts).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// orderSectionsByLinks and assignPatchedSections branches
// ---------------------------------------------------------------------------

describe('orderSectionsByLinks and assignPatchedSections branches', () => {
	it('PATCH with circular-link old sections falls back to id-sort and completes', async () => {
		const resolver: QueryResolver = (sql, _args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (_args[0] === 'circular')
					return { success: true, results: [{ filename: 'circular', display_name: 'Circular', isNested: 0, alternate_filename: null }] };
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return {
					success: true,
					results: [
						{ section_id: 10, previous_section_id: 20, next_section_id: 20, section_speaker: 'A', section_content: '<p>a</p>' },
						{ section_id: 20, previous_section_id: 10, next_section_id: 10, section_speaker: 'A', section_content: '<p>b</p>' },
					],
				};
			}
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
				return { success: true, results: [{ speaker_route_pathname: 'A' }] };
			if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 100 + Number(_args[0] || 1) }] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'circular', markdown: '# Circular\n## A:\nfresh body text' }),
		});
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// orderSectionsByLinks remaining-after-chain branch
// ---------------------------------------------------------------------------

describe('orderSectionsByLinks remaining-after-chain branch', () => {
	it('handles a broken chain where next points outside the set and leaves rows behind', async () => {
		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'broken-next')
					return { success: true, results: [{ filename: 'broken-next', display_name: 'Broken', isNested: 0, alternate_filename: null }] };
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return {
					success: true,
					results: [
						{ section_id: 100, previous_section_id: null, next_section_id: 999, section_speaker: 'A', section_content: '<p>a</p>' },
						{ section_id: 300, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>b</p>' },
						{ section_id: 200, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>c</p>' },
					],
				};
			}
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
				return { success: true, results: [{ speaker_route_pathname: 'A' }] };
			if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 301 + Number(args[0] || 1) }] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'broken-next', markdown: '# Broken\n## A:\nfresh content' }),
		});
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// LCS paired-inner-loop push
// ---------------------------------------------------------------------------

describe('LCS paired-inner-loop push', () => {
	it('preserves ids when old and new share multiple LCS anchors with different content between them', async () => {
		const oldContent = [
			{ section_id: 100, previous_section_id: null, next_section_id: 101, section_speaker: 'A', section_content: '<p>X</p>' },
			{ section_id: 101, previous_section_id: 100, next_section_id: 102, section_speaker: 'A', section_content: '<p>M1</p>' },
			{ section_id: 102, previous_section_id: 101, next_section_id: 103, section_speaker: 'A', section_content: '<p>Y</p>' },
			{ section_id: 103, previous_section_id: 102, next_section_id: 104, section_speaker: 'A', section_content: '<p>M2</p>' },
			{ section_id: 104, previous_section_id: 103, next_section_id: null, section_speaker: 'A', section_content: '<p>Z</p>' },
		];
		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'lcs-multi')
					return { success: true, results: [{ filename: 'lcs-multi', display_name: 'LCS Multi', isNested: 0, alternate_filename: null }] };
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: oldContent };
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
				return { success: true, results: [{ speaker_route_pathname: 'A' }] };
			if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 105 + Number(args[0] || 1) }] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'lcs-multi', markdown: '# LCS Multi\n## A:\nA\n\nM1\n\nB\n\nM2\n\nC' }),
		});
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// LCS pairs iteration branches (buildLcsPairs)
// ---------------------------------------------------------------------------

describe('LCS pairs iteration branches (buildLcsPairs)', () => {
	it('threads insertions+retentions when old and new share a single middle section', async () => {
		const oldContent = [
			{ section_id: 100, previous_section_id: null, next_section_id: 101, section_speaker: 'A', section_content: '<p>old X</p>' },
			{ section_id: 101, previous_section_id: 100, next_section_id: 102, section_speaker: 'A', section_content: '<p>middle Y</p>' },
			{ section_id: 102, previous_section_id: 101, next_section_id: null, section_speaker: 'A', section_content: '<p>old Z</p>' },
		];
		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'lcs-demo')
					return { success: true, results: [{ filename: 'lcs-demo', display_name: 'LCS', isNested: 0, alternate_filename: null }] };
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: oldContent };
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
				return { success: true, results: [{ speaker_route_pathname: 'A' }] };
			if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 103 + Number(args[0] || 1) }] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'lcs-demo', markdown: '# LCS\n## A:\nnew A\n\nnew B\n\nmiddle Y\n\nnew D\n\nnew E' }),
		});
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// PATCH alternate_filename explicit null
// ---------------------------------------------------------------------------

describe('PATCH alternate_filename explicit null', () => {
	it('unsets existing alternate when null is explicitly passed', async () => {
		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'unset-alt')
					return {
						success: true,
						results: [{ filename: 'unset-alt', display_name: 'UA', isNested: 0, alternate_filename: 'old-partner' }],
					};
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: [] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 1001 + Number(args[0] || 1) }] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'unset-alt', markdown: '# Unset\n## A:\nstill here', alternate_filename: null }),
		});
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// PATCH >99 inserts uses reserved fresh ids
// ---------------------------------------------------------------------------

describe('PATCH >99 inserts uses reserved fresh ids', () => {
	it('succeeds when one gap contains more than 99 new sections', async () => {
		const oldSections = [
			{ section_id: 500, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>anchor-X</p>' },
		];
		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'too-many')
					return { success: true, results: [{ filename: 'too-many', display_name: 'Many', isNested: 0, alternate_filename: null }] };
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: oldSections };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 501 + Number(args[0] || 1) }] };
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) return { success: true, results: [] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const newSections = '## A:\nanchor-X\n\n' + Array.from({ length: 100 }, (_, i) => `## A:\ninserted-${i}`).join('\n\n');
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'too-many', markdown: `# Too Many\n${newSections}` }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			success: boolean;
			filename: string;
			sectionsCount: number;
			insertedCount: number;
			updatedCount: number;
			deletedCount: number;
		};
		expect(body).toMatchObject({
			success: true,
			filename: 'too-many',
			sectionsCount: 101,
			insertedCount: 100,
			updatedCount: 1,
			deletedCount: 0,
		});
		const insertedIds = boundStmts(env)
			.filter((stmt) => stmt.sql.startsWith('INSERT INTO speech_content'))
			.map((stmt) => stmt.args[3]);
		expect(insertedIds).toHaveLength(100);
		expect(new Set(insertedIds).size).toBe(100);
		expect(insertedIds).toEqual(Array.from({ length: 100 }, (_, i) => 501 + i));
	});
});

// ---------------------------------------------------------------------------
// invalidateSpeakerCaches empty-route skip branch
// ---------------------------------------------------------------------------

describe('invalidateSpeakerCaches empty-route skip branch', () => {
	it('skips cache invalidation entries for empty/null speaker routes', async () => {
		const resolver: QueryResolver = (sql, _args) => {
			if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return {
					success: true,
					results: [{ speaker_route_pathname: '' }, { speaker_route_pathname: null }, { speaker_route_pathname: 'valid-speaker' }],
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count')) return { success: true, results: [{ count: 0 }] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown?filename=del-empty-speakers', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(200);
		// valid-speaker URL should be among deleted keys (absent from r2Store)
		// Check batched DELETE statements for the speaker route
		const speakerDeletes = boundStmts(env).filter(
			(s) => s.sql.includes('DELETE FROM speakers WHERE route_pathname = ?') && s.args[0] === 'valid-speaker',
		);
		expect(speakerDeletes.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// syncSearchArtifacts error logging
// ---------------------------------------------------------------------------

describe('syncSearchArtifacts error logging', () => {
	it('returns 503 with searchSync false when the search sync rejects on upsert', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) return { success: true, results: [] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return reservedCounterResult(300, args);
			return { success: true, results: [] };
		});
		// Make search-related R2 puts fail
		const originalPut = env.SPEECH_CACHE.put.bind(env.SPEECH_CACHE);
		env.SPEECH_CACHE.put = async (key: string, body: string) => {
			if (key.startsWith('search-updates/') || key === 'stats.json' || key === 'search-index-manifest.json') {
				throw new Error('search sync failed');
			}
			return originalPut(key, body);
		};
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'search-fail', markdown: '# Fail\n## A:\nhi' }),
		});
		expect(res.status).toBe(503);
		const json = (await res.json()) as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(true);
		expect(json.searchSync).toBe(false);
	});

	it('returns 503 with searchSync false when the search sync rejects on delete', async () => {
		const resolver: QueryResolver = (sql, _args) => {
			if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) return { success: true, results: [] };
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) return { success: true, results: [{ section_id: 1 }] };
			if (sql.includes('SELECT COUNT(*) AS count')) return { success: true, results: [{ count: 0 }] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const originalPut = env.SPEECH_CACHE.put.bind(env.SPEECH_CACHE);
		env.SPEECH_CACHE.put = async (key: string, body: string) => {
			if (key.startsWith('search-updates/') || key === 'stats.json' || key === 'search-index-manifest.json') {
				throw new Error('search sync failed');
			}
			return originalPut(key, body);
		};
		const { res } = await dispatch('/api/upload_markdown?filename=del-search-fail', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(503);
		const json = (await res.json()) as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(true);
		expect(json.searchSync).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// assignPatchedSections branches — many inserted sections (direct call)
// ---------------------------------------------------------------------------

describe('assignPatchedSections branches — many inserted sections', () => {
	it('threads new sections into a short old list (tail-insertion with no LCS matches)', async () => {
		const { ctx } = makeDirectContext(
			(sql, args) => {
				if (sql.includes('FROM speech_index WHERE filename = ?')) {
					if (args[0] === 'many-inserts')
						return { success: true, results: [{ filename: 'many-inserts', display_name: 'Many', isNested: 0, alternate_filename: null }] };
					return { success: true, results: [] };
				}
				if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
					return {
						success: true,
						results: [
							{
								section_id: 500,
								previous_section_id: null,
								next_section_id: null,
								section_speaker: 'A',
								section_content: '<p>totally-different-old-content</p>',
							},
						],
					};
				}
				if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
				if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
					return reservedCounterResult(500, args);
				}
				return { success: true, results: [] };
			},
			{ body: { filename: 'many-inserts', markdown: '# Many\n## A:\nA\n\nB\n\nC\n\nD\n\nE' } },
		);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);
	});

	it('allocates a reserved fresh id inside an insertion gap', async () => {
		const { ctx, batchStatements } = makeDirectContext(
			(sql, args) => {
				if (sql.includes('FROM speech_index WHERE filename = ?')) {
					if (args[0] === 'many-inserts')
						return { success: true, results: [{ filename: 'many-inserts', display_name: 'Many', isNested: 0, alternate_filename: null }] };
					return { success: true, results: [] };
				}
				if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
					return {
						success: true,
						results: [
							{
								section_id: 1,
								previous_section_id: null,
								next_section_id: 101,
								section_speaker: 'A',
								section_content: '<p>anchor one</p>',
							},
							{
								section_id: 101,
								previous_section_id: 1,
								next_section_id: null,
								section_speaker: 'A',
								section_content: '<p>anchor two</p>',
							},
						],
					};
				}
				if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
				if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return reservedCounterResult(101, args);
				return { success: true, results: [] };
			},
			{ body: { filename: 'many-inserts', markdown: '# Many\n## A:\nanchor one\n\ninserted between\n\nanchor two' } },
		);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);
		const insertedIds = batchStatements.filter((stmt) => stmt.sql.startsWith('INSERT INTO speech_content')).map((stmt) => stmt.args[3]);
		expect(insertedIds).toEqual([102]);
	});

	it('allocates sequential reserved fresh IDs for multiple inserted sections', async () => {
		const oldSections = [
			{ section_id: 1, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>anchor</p>' },
		];
		const { ctx, batchStatements } = makeDirectContext(
			(sql, args) => {
				if (sql.includes('FROM speech_index WHERE filename = ?')) {
					if (args[0] === 'overflow-fresh')
						return { success: true, results: [{ filename: 'overflow-fresh', display_name: 'X', isNested: 0, alternate_filename: null }] };
					return { success: true, results: [] };
				}
				if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: oldSections };
				if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
				if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return reservedCounterResult(49999, args);
				return { success: true, results: [] };
			},
			{ body: { filename: 'overflow-fresh', markdown: '# X\n## A:\nanchor\n\nins1\n\nins2\n\nins3' } },
		);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);
		const insertedIds = batchStatements.filter((stmt) => stmt.sql.startsWith('INSERT INTO speech_content')).map((stmt) => stmt.args[3]);
		expect(insertedIds).toEqual([50000, 50001, 50002]);
	});

	it('allocates fresh global ids (not base+1) when the anchor is already a sub-section id', async () => {
		const anchorId = 63852882;
		const oldSections = [
			{ section_id: anchorId, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>anchor</p>' },
		];
		const { ctx, batchStatements } = makeDirectContext(
			(sql, args) => {
				if (sql.includes('FROM speech_index WHERE filename = ?')) {
					if (args[0] === 'sub-anchor-insert')
						return {
							success: true,
							results: [{ filename: 'sub-anchor-insert', display_name: 'X', isNested: 0, alternate_filename: null }],
						};
					return { success: true, results: [] };
				}
				if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: oldSections };
				if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
				if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('SELECT section_id FROM speech_content WHERE filename != ?')) return { success: true, results: [] };
				if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return reservedCounterResult(70000000, args);
				return { success: true, results: [] };
			},
			{ body: { filename: 'sub-anchor-insert', markdown: '# X\n## A:\nanchor\n\nbrand new section' } },
		);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);
		const insertedIds = batchStatements.filter((stmt) => stmt.sql.startsWith('INSERT INTO speech_content')).map((stmt) => stmt.args[3]);
		expect(insertedIds.length).toBeGreaterThanOrEqual(1);
		for (const id of insertedIds) {
			expect(id).toBeGreaterThan(70000000);
			expect(id).not.toBe(anchorId + 1);
		}
		expect(insertedIds[0]).toBe(70000001);
	});

	it('reservation starts above existing section ids even when the counter was stale', async () => {
		const oldSections = [
			{ section_id: 1, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>anchor</p>' },
		];
		const { ctx, batchStatements } = makeDirectContext(
			(sql, args) => {
				if (sql.includes('FROM speech_index WHERE filename = ?')) {
					if (args[0] === 'fresh-collision')
						return { success: true, results: [{ filename: 'fresh-collision', display_name: 'X', isNested: 0, alternate_filename: null }] };
					return { success: true, results: [] };
				}
				if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: oldSections };
				if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
				if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return reservedCounterResult(1, args);
				return { success: true, results: [] };
			},
			{ body: { filename: 'fresh-collision', markdown: '# X\n## A:\nanchor\n\nins1\n\nins2' } },
		);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);
		const insertedIds = batchStatements.filter((stmt) => stmt.sql.startsWith('INSERT INTO speech_content')).map((stmt) => stmt.args[3]);
		expect(insertedIds).not.toContain(1);
		expect(insertedIds).toEqual([2, 3]);
	});

	it('allocates a fresh id beyond another speech collision candidate', async () => {
		const oldSections = [
			{ section_id: 1, previous_section_id: null, next_section_id: 200, section_speaker: 'A', section_content: '<p>anchor one</p>' },
			{ section_id: 200, previous_section_id: 1, next_section_id: null, section_speaker: 'A', section_content: '<p>anchor two</p>' },
		];
		const { ctx, batchStatements } = makeDirectContext(
			(sql, args) => {
				if (sql.includes('FROM speech_index WHERE filename = ?')) {
					if (args[0] === 'cross-collision')
						return { success: true, results: [{ filename: 'cross-collision', display_name: 'X', isNested: 0, alternate_filename: null }] };
					return { success: true, results: [] };
				}
				if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: oldSections };
				if (sql.includes('FROM speech_speakers WHERE speech_filename = ?'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
				if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers'))
					return { success: true, results: [{ speaker_route_pathname: 'A' }] };
				if (sql.includes('SELECT section_id FROM speech_content WHERE filename != ?'))
					return { success: true, results: [{ section_id: 101 }] };
				if (sql.includes('section_id_counter') && sql.includes('RETURNING')) return reservedCounterResult(200, args);
				return { success: true, results: [] };
			},
			{ body: { filename: 'cross-collision', markdown: '# X\n## A:\nanchor one\n\ninserted between\n\nanchor two' } },
		);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);
		const insertedIds = batchStatements.filter((stmt) => stmt.sql.startsWith('INSERT INTO speech_content')).map((stmt) => stmt.args[3]);
		expect(insertedIds).not.toContain(101);
		expect(insertedIds).toEqual([201]);
	});
});

// ---------------------------------------------------------------------------
// PATCH treats svg / iframe blocks as match anchors (issue #68)
// ---------------------------------------------------------------------------

describe('PATCH treats svg / iframe blocks as match anchors (issue #68)', () => {
	it('preserves the svg section_id when prose is inserted before it and inner svg markup changes', async () => {
		const oldSections = [
			{
				section_id: 100,
				previous_section_id: null,
				next_section_id: 200,
				section_speaker: 'A',
				section_content: '<p>Intro paragraph here.</p>',
			},
			{
				section_id: 200,
				previous_section_id: 100,
				next_section_id: null,
				section_speaker: 'A',
				section_content: '<svg viewBox="0 0 100 100"><title>Old Chart</title><circle/></svg>',
			},
		];
		const env = createMockEnv(speakerResolver('svg-anchor', oldSections));
		const newMarkdown = [
			'# svg-anchor',
			'## A:',
			'Intro paragraph here.',
			'',
			'Added explanation paragraph.',
			'',
			'<svg viewBox="0 0 200 200"><title>New Chart</title><rect/></svg>',
		].join('\n');
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'svg-anchor', markdown: newMarkdown }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { sectionsCount: number; insertedCount: number; updatedCount: number; deletedCount: number };
		expect(json).toMatchObject({ sectionsCount: 3, insertedCount: 1, updatedCount: 2, deletedCount: 0 });
		const updateOps = boundStmts(env).filter((s) => s.sql.startsWith('UPDATE speech_content'));
		const svgUpdate = updateOps.find((s) => s.args[5] === 200);
		expect(svgUpdate).toBeDefined();
		const svgContent = svgUpdate!.args[3] as string;
		expect(svgContent).toContain('<svg');
		expect(svgContent).toContain('New Chart');
		const insertOps = boundStmts(env).filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		const explanationInsert = insertOps.find((s) => {
			const content = s.args[7];
			return typeof content === 'string' && content.includes('Added explanation');
		});
		expect(explanationInsert).toBeDefined();
		expect(explanationInsert!.args[3]).not.toBe(200);
		expect(explanationInsert!.args[3]).toBeGreaterThan(200);
	});

	it('preserves the iframe section_id when iframe src changes and an unrelated section is inserted', async () => {
		const oldSections = [
			{
				section_id: 100,
				previous_section_id: null,
				next_section_id: 300,
				section_speaker: 'A',
				section_content: '<p>Lead-in sentence.</p>',
			},
			{
				section_id: 300,
				previous_section_id: 100,
				next_section_id: null,
				section_speaker: 'A',
				section_content: '<iframe src="https://old.example.com/embed/abc"></iframe>',
			},
		];
		const env = createMockEnv(speakerResolver('iframe-anchor', oldSections));
		const newMarkdown = [
			'# iframe-anchor',
			'## A:',
			'Lead-in sentence.',
			'',
			'A note added between.',
			'',
			'<iframe src="https://new.example.com/embed/xyz"></iframe>',
		].join('\n');
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'iframe-anchor', markdown: newMarkdown }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { sectionsCount: number; insertedCount: number; updatedCount: number; deletedCount: number };
		expect(json).toMatchObject({ sectionsCount: 3, insertedCount: 1, updatedCount: 2, deletedCount: 0 });
		const updateOps = boundStmts(env).filter((s) => s.sql.startsWith('UPDATE speech_content'));
		const iframeUpdate = updateOps.find((s) => s.args[5] === 300);
		expect(iframeUpdate).toBeDefined();
		const iframeContent = iframeUpdate!.args[3] as string;
		expect(iframeContent).toContain('<iframe');
		expect(iframeContent).toContain('new.example.com');
		const insertOps = boundStmts(env).filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		const noteInsert = insertOps.find((s) => {
			const content = s.args[7];
			return typeof content === 'string' && content.includes('A note added between');
		});
		expect(noteInsert).toBeDefined();
		expect(noteInsert!.args[3]).not.toBe(300);
		expect(noteInsert!.args[3]).toBeGreaterThan(300);
	});

	it('does NOT short-circuit when a section mixes iframe with surrounding prose', async () => {
		const oldSections = [
			{
				section_id: 50,
				previous_section_id: null,
				next_section_id: null,
				section_speaker: 'A',
				section_content: '<p>Old prose around an iframe: <iframe src="A"></iframe> done.</p>',
			},
		];
		const env = createMockEnv(speakerResolver('mixed-iframe', oldSections));
		const newMarkdown = ['# mixed-iframe', '## A:', 'New prose around an iframe: <iframe src="B"></iframe> done.'].join('\n');
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'mixed-iframe', markdown: newMarkdown }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { sectionsCount: number; updatedCount: number; insertedCount: number; deletedCount: number };
		expect(json).toMatchObject({ sectionsCount: 1, updatedCount: 1, insertedCount: 0, deletedCount: 0 });
		const updateOps = boundStmts(env).filter((s) => s.sql.startsWith('UPDATE speech_content'));
		expect(updateOps.find((s) => s.args[5] === 50)).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// uploadMarkdown direct — unsupported method (direct call)
// ---------------------------------------------------------------------------

describe('uploadMarkdown direct — unsupported method', () => {
	it('returns 400 with method-not-supported when called with PUT', async () => {
		const { ctx } = makeDirectContext(() => ({ success: true, results: [] }), { method: 'PUT' });
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Method not supported' });
	});

	it('returns 400 for GET (read-only verb should be rejected as unsupported)', async () => {
		const { ctx } = makeDirectContext(() => ({ success: true, results: [] }), { method: 'GET' });
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// uploadMarkdown PATCH — orphan speech_speakers cleanup (direct call)
// ---------------------------------------------------------------------------

describe('uploadMarkdown PATCH — orphan speech_speakers cleanup', () => {
	it('issues relation and speaker cleanup when speech_speakers lists slugs no longer in use', async () => {
		const { ctx, batchStatements } = makeDirectContext(
			(sql, args) => {
				if (sql.includes('FROM speech_index WHERE filename = ?')) {
					if (args[0] === 'orphan-demo')
						return {
							success: true,
							results: [{ filename: 'orphan-demo', display_name: 'Orphan Demo', isNested: 0, alternate_filename: null }],
						};
					return { success: true, results: [] };
				}
				if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
					return {
						success: true,
						results: [
							{
								section_id: 10,
								previous_section_id: null,
								next_section_id: null,
								section_speaker: 'A',
								section_content: '<p>old content</p>',
							},
						],
					};
				}
				if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
					return { success: true, results: [{ speaker_route_pathname: 'A' }, { speaker_route_pathname: 'ZOMBIE' }] };
				}
				if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [{ section_speaker: 'A' }] };
				return { success: true, results: [] };
			},
			{ body: { filename: 'orphan-demo', markdown: '# Orphan Demo\n## A:\nstill here' } },
		);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);
		const wipeRelations = batchStatements.filter(
			(s) => s.sql === 'DELETE FROM speech_speakers WHERE speech_filename = ?' && s.args[0] === 'orphan-demo',
		);
		expect(wipeRelations.length).toBeGreaterThan(0);
		const relationInserts = batchStatements.filter((s) => s.sql.includes('INSERT OR IGNORE INTO speech_speakers'));
		const insertedSpeakers = relationInserts.map((s) => s.args[1]);
		expect(insertedSpeakers).toContain('A');
		expect(insertedSpeakers).not.toContain('ZOMBIE');
		const zombieSpeakerDeletes = batchStatements.filter(
			(s) => s.sql.includes('DELETE FROM speakers WHERE route_pathname = ?') && s.args[0] === 'ZOMBIE',
		);
		expect(zombieSpeakerDeletes.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// decodeURIComponent catch for speaker name (coverage-theater: simplified)
// ---------------------------------------------------------------------------

describe('decodeURIComponent catch for speaker name', () => {
	it('keeps raw route_pathname when decode fails (POST)', async () => {
		// Coverage-theater: the original test's own comment admits it is impossible
		// to produce a malformed %-sequence through normalizeSpeakerName (which uses
		// encodeURIComponent). The test was a smoke-test of the happy path for `## 50%:`
		// which produces `50%25` and round-trips fine. Kept as-is because it still
		// exercises the POST path with a %-heading, but the "catch" branch it names
		// is defensive and unreachable by any real caller.
		const env = createMockEnv((sql, args) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) return { success: true, results: [] };
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 11 + Number(args[0] || 1) }] };
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'percent-name', markdown: '# Percent\n## 50%:\nat fifty' }),
		});
		expect(res.status).toBe(200);
	});
});
