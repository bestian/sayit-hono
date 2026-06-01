import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type PreparedStatement = { sql: string; args: unknown[] };

function createPostEnv(options: { hasExistingFilename?: boolean; redirects?: Record<string, string> } = {}) {
	const operations: PreparedStatement[] = [];
	const deletedKeys: string[] = [];
	const putObjects = new Map<string, string>();
	const redirects: Record<string, string> = options.redirects ?? {};

	function query(sql: string, args: unknown[]) {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			if (options.hasExistingFilename && args[0] === 'new-speech') {
				return { success: true, results: [{ filename: 'new-speech', display_name: 'new-speech' }] };
			}
			return { success: true, results: [] };
		}
		if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
			return { success: true, results: [{ next_id: 1001 + Number(args[0] || 1) }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) {
			return { success: true, results: [{ count: 1 }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) {
			return { success: true, results: [{ count: 1 }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) {
			return { success: true, results: [{ count: 2 }] };
		}
		if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename')) {
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) {
			const target = redirects[String(args[0])];
			return { success: true, results: target ? [{ new_filename: target }] : [] };
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
					all: async () => query(sql, args)
				});
				return {
					bind: (...args: unknown[]) => run(args),
					first: async () => run([]).first(),
					all: async () => run([]).all()
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
		__deletedKeys: deletedKeys,
		__putObjects: putObjects
	};
}

async function request(
	path: string,
	env: ReturnType<typeof createPostEnv>,
	init?: RequestInit<IncomingRequestCfProperties>
) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('POST /api/upload_markdown — new speech creation', () => {
	it('creates speech_index, speakers (ON CONFLICT), speech_speakers, and speech_content', async () => {
		const env = createPostEnv();

		const markdown = [
			'# New Speech',
			'## Audrey Tang:',
			'Hello world.',
			'',
			'## Bestian:',
			'Another paragraph.'
		].join('\n');

		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({ filename: 'new-speech', markdown })
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; filename: string; sectionsCount: number };
		expect(json).toEqual({ success: true, filename: 'new-speech', sectionsCount: 2 });

		const indexInsert = env.__operations.find((s) => s.sql.startsWith('INSERT INTO speech_index'));
		expect(indexInsert).toBeDefined();
		expect(indexInsert!.args[0]).toBe('new-speech');
		expect(indexInsert!.args[1]).toBe('New Speech');

		const speakerUpserts = env.__operations.filter((s) => s.sql.includes('INSERT INTO speakers'));
		expect(speakerUpserts.length).toBe(2);
		expect(speakerUpserts.map((s) => s.args[0])).toEqual(
			expect.arrayContaining(['Audrey%20Tang', 'Bestian'])
		);
		// ON CONFLICT clause is present
		expect(speakerUpserts[0].sql).toContain('ON CONFLICT');

		const speechSpeakersLinks = env.__operations.filter((s) => s.sql.includes('INSERT OR IGNORE INTO speech_speakers'));
		expect(speechSpeakersLinks.length).toBe(2);
		expect(speechSpeakersLinks.map((s) => s.args)).toEqual(
			expect.arrayContaining([
				['new-speech', 'Audrey%20Tang'],
				['new-speech', 'Bestian']
			])
		);

		const contentInserts = env.__operations.filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		expect(contentInserts.length).toBeGreaterThan(0);
	});

	it('rewrites filename via speech_redirects when speech_index misses, treating canonical as the existing target', async () => {
		const env = createPostEnv({
			redirects: { 'deprecated-name': 'canonical-name' }
		});

		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({ filename: 'deprecated-name', markdown: '# Canonical\n## A:\nHi' })
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as { filename: string };
		// All writes should target the canonical filename, not the deprecated one
		expect(json.filename).toBe('canonical-name');
		const indexInsert = env.__operations.find((s) => s.sql.startsWith('INSERT INTO speech_index'));
		expect(indexInsert!.args[0]).toBe('canonical-name');
	});

	it('deletes prior rows before re-inserting when filename already exists (idempotent)', async () => {
		const env = createPostEnv({ hasExistingFilename: true });

		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({ filename: 'new-speech', markdown: '# New\n## A:\nHi' })
		});

		expect(res.status).toBe(200);
		// First batch should include the cleanup deletes
		const deleteContent = env.__operations.find((s) => s.sql.startsWith('DELETE FROM speech_content'));
		const deleteRelations = env.__operations.find((s) => s.sql.startsWith('DELETE FROM speech_speakers'));
		const deleteIndex = env.__operations.find((s) => s.sql.startsWith('DELETE FROM speech_index'));
		expect(deleteContent).toBeDefined();
		expect(deleteRelations).toBeDefined();
		expect(deleteIndex).toBeDefined();
	});

	it('invalidates speech, speakers, and list-page caches', async () => {
		const env = createPostEnv();

		await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({ filename: 'new-speech', markdown: '# New\n## A:\nHi' })
		});

		expect(env.__deletedKeys).toEqual(expect.arrayContaining([
			`${CACHE_KEY_VERSION}/example.com/new-speech`,
			`${CACHE_KEY_VERSION}/example.com/speaker/A`,
			`${CACHE_KEY_VERSION}/example.com/speakers`,
			`${CACHE_KEY_VERSION}/example.com/speeches`,
			`${CACHE_KEY_VERSION}/example.com/rss.xml`
		]));
	});

	it('rejects missing filename with 400', async () => {
		const env = createPostEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({ markdown: '# X\nY' })
		});
		expect(res.status).toBe(400);
	});

	it('rejects missing markdown with 400', async () => {
		const env = createPostEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({ filename: 'x' })
		});
		expect(res.status).toBe(400);
	});

	it('rejects invalid JSON body with 400', async () => {
		const env = createPostEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: '{not json'
		});
		expect(res.status).toBe(400);
	});

	it('strips <script> tags from section content (XSS guard)', async () => {
		const env = createPostEnv();

		await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'new-speech',
				markdown: '# Title\n## A:\nHello <script>alert(1)</script> world'
			})
		});

		const contentInserts = env.__operations.filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		// section_content is the 8th binding (0-indexed 7)
		const allContent = contentInserts.flatMap((s) => s.args).join('\n');
		expect(allContent).not.toContain('<script>');
		expect(allContent).not.toContain('alert(1)');
	});

	it('creates bidirectional alternate_filename link', async () => {
		const env = createPostEnv();

		await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'new-speech',
				markdown: '# New\n## A:\nHi',
				alternate_filename: 'paired-speech'
			})
		});

		const altUpdates = env.__operations.filter((s) =>
			s.sql.includes('UPDATE speech_index SET alternate_filename')
		);
		expect(altUpdates.length).toBe(2);
		expect(altUpdates.map((s) => s.args)).toEqual(
			expect.arrayContaining([
				['paired-speech', 'new-speech'],
				['new-speech', 'paired-speech']
			])
		);
	});
});
