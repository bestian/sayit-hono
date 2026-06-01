import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type PreparedStatement = { sql: string; args: unknown[] };

type SpeechIndexRow = {
	filename: string;
	display_name: string;
	isNested: number;
	nest_filenames: string;
	nest_display_names: string;
	alternate_filename?: string | null;
};

function createUpsertEnv(options: {
	/** If set, this filename exists in speech_index already */
	existingFilename?: string;
	/** Rows to return for the speech_index lookup */
	speechIndexRows?: SpeechIndexRow[];
	/** speech_redirects mapping: old_filename -> new_filename */
	redirects?: Record<string, string>;
} = {}) {
	const operations: PreparedStatement[] = [];
	const directStatements: PreparedStatement[] = [];
	const deletedKeys: string[] = [];
	const putObjects = new Map<string, string>();
	const speechIndexRows: SpeechIndexRow[] = options.speechIndexRows ?? [];
	const redirects: Record<string, string> = options.redirects ?? {};

	function query(sql: string, args: unknown[]) {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			return { success: true, results: speechIndexRows.filter((row) => row.filename === args[0]) };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) {
			return { success: true, results: [{ count: speechIndexRows.length }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) {
			return { success: true, results: [{ count: 0 }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) {
			return { success: true, results: [{ count: 0 }] };
		}
		if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
			return { success: true, results: [{ next_id: 501 + Number(args[0] || 1) }] };
		}
		if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename')) {
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT DISTINCT section_speaker')) {
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) {
			const target = redirects[String(args[0])];
			return { success: true, results: target ? [{ new_filename: target }] : [] };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename != ?')) {
			return { success: true, results: [] };
		}
		throw new Error(`Unexpected query: ${sql}`);
	}

	return {
		AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
		BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
		ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
		SPEECH_CACHE: {
			delete: async (key: string) => {
				deletedKeys.push(key);
				return true;
			},
			get: async () => null,
			put: async (key: string, body: string) => {
				putObjects.set(key, body);
			},
			list: async () => ({ objects: [], truncated: false, cursor: '' })
		},
		DB: {
			prepare: (sql: string) => {
				const run = (args: unknown[]) => ({
					sql,
					args,
					first: async () => {
						const result = query(sql, args);
						return result.results[0] ?? null;
					},
					all: async () => query(sql, args),
					run: async () => {
						directStatements.push({ sql, args });
						return { success: true, meta: { changes: 1 } };
					}
				});
				return {
					bind: (...args: unknown[]) => run(args),
					first: async () => run([]).first(),
					all: async () => run([]).all(),
					run: async () => run([]).run()
				};
			},
			batch: async (statements: PreparedStatement[]) => {
				for (const stmt of statements) {
					if (typeof stmt.sql === 'string') operations.push(stmt);
				}
				return statements.map(() => ({ meta: { changes: 1 } }));
			}
		},
		__operations: operations,
		__directStatements: directStatements,
		__deletedKeys: deletedKeys,
		__putObjects: putObjects
	};
}

async function request(
	path: string,
	env: ReturnType<typeof createUpsertEnv>,
	init?: RequestInit<IncomingRequestCfProperties>
) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res, ctx };
}

describe('PATCH /api/upload_markdown — upsert when filename missing', () => {
	it('auto-creates speech_index row and returns 200', async () => {
		const env = createUpsertEnv(); // no rows → missing filename

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'fresh-speech',
				markdown: '# Fresh Speech\nHello world'
			})
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean };
		expect(json.success).toBe(true);

		// The upsert fires a direct .run() INSERT INTO speech_index
		const insertStmt = env.__directStatements.find((s) => s.sql.includes('INSERT INTO speech_index'));
		expect(insertStmt).toBeDefined();
		expect(insertStmt!.args).toEqual(['fresh-speech', 'fresh-speech', '', '']);
	});

	it('rewrites filename via speech_redirects when speech_index misses, and does not auto-create', async () => {
		const env = createUpsertEnv({
			redirects: { 'deprecated-filename': 'canonical-filename' },
			speechIndexRows: [{
				filename: 'canonical-filename',
				display_name: 'Canonical',
				isNested: 0,
				nest_filenames: '',
				nest_display_names: '',
				alternate_filename: null
			}]
		});

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'deprecated-filename',
				markdown: '# Canonical\nContent'
			})
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; filename: string };
		expect(json.success).toBe(true);
		// Response carries the canonical filename, not the deprecated one
		expect(json.filename).toBe('canonical-filename');
		// No INSERT INTO speech_index because the canonical row already exists
		const insertStmt = env.__directStatements.find((s) => s.sql.includes('INSERT INTO speech_index'));
		expect(insertStmt).toBeUndefined();
	});

	it('does NOT call the upsert insert when row already exists', async () => {
		const env = createUpsertEnv({
			speechIndexRows: [{
				filename: 'existing-speech',
				display_name: 'Existing',
				isNested: 0,
				nest_filenames: '',
				nest_display_names: '',
				alternate_filename: null
			}]
		});

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'existing-speech',
				markdown: '# Existing\nNew content'
			})
		});

		expect(res.status).toBe(200);
		const insertStmt = env.__directStatements.find((s) => s.sql.includes('INSERT INTO speech_index'));
		expect(insertStmt).toBeUndefined();
	});

	it('rejects alternate_filename === filename with 400', async () => {
		const env = createUpsertEnv({
			speechIndexRows: [{
				filename: 'dup',
				display_name: 'Dup',
				isNested: 0,
				nest_filenames: '',
				nest_display_names: '',
				alternate_filename: null
			}]
		});

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'dup',
				markdown: '# X\nY',
				alternate_filename: 'dup'
			})
		});

		expect(res.status).toBe(400);
	});

	it('rejects non-string alternate_filename with 400', async () => {
		const env = createUpsertEnv({
			speechIndexRows: [{
				filename: 'x',
				display_name: 'X',
				isNested: 0,
				nest_filenames: '',
				nest_display_names: '',
				alternate_filename: null
			}]
		});

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'x',
				markdown: '# X\nY',
				alternate_filename: 123
			})
		});

		expect(res.status).toBe(400);
	});
});

describe('PATCH /api/upload_markdown — edge cache (real-URL) invalidation', () => {
	it('purges seeded real URLs from caches.default on PATCH', async () => {
		const env = createUpsertEnv({
			speechIndexRows: [{
				filename: 'demo-speech',
				display_name: 'Demo',
				isNested: 0,
				nest_filenames: '',
				nest_display_names: '',
				alternate_filename: null
			}]
		});

		const urlsToPurge = [
			'https://example.com/demo-speech',
			'https://example.com/speeches',
			'https://example.com/speeches/',
			'https://example.com/rss.xml',
			'https://example.com/feed.xml'
		];
		for (const url of urlsToPurge) {
			await caches.default.put(url, new Response('seeded', {
				headers: { 'Cache-Control': 'public, max-age=3600' }
			}));
		}
		// Sanity: they are in cache
		for (const url of urlsToPurge) {
			expect(await caches.default.match(url)).toBeDefined();
		}

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo\nUpdated'
			})
		});

		expect(res.status).toBe(200);
		for (const url of urlsToPurge) {
			expect(await caches.default.match(url)).toBeUndefined();
		}
	});
});
