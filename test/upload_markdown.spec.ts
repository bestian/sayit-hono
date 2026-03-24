import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type PreparedStatement = {
	sql: string;
	args: unknown[];
};

function createUploadEnv(options?: { currentAlternateFilename?: string | null }) {
	const operations: PreparedStatement[] = [];
	const deletedKeys: string[] = [];
	const currentAlternateFilename = options?.currentAlternateFilename ?? null;

	const speechIndexRows = [
		{
			filename: 'demo-speech',
			display_name: 'Demo Speech',
			isNested: 0,
			nest_filenames: '',
			nest_display_names: '',
			alternate_filename: currentAlternateFilename
		}
	];

	const oldSections = [
		{
			filename: 'demo-speech',
			section_id: 100,
			previous_section_id: null,
			next_section_id: 101,
			section_speaker: null,
			section_content: '<p>Alpha</p>'
		},
		{
			filename: 'demo-speech',
			section_id: 101,
			previous_section_id: 100,
			next_section_id: null,
			section_speaker: null,
			section_content: '<p>Beta</p>'
		}
	];

	function query(sql: string, args: unknown[]) {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			return { success: true, results: speechIndexRows };
		}
		if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
			return { success: true, results: oldSections };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
			if (args[0] === 'old-paired') {
				return { success: true, results: [{ section_id: 99001 }] };
			}
			if (args[0] === 'paired-speech') {
				return { success: true, results: [{ section_id: 99002 }] };
			}
			return { success: true, results: oldSections.map(({ section_id }) => ({ section_id })) };
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
		throw new Error(`Unexpected query: ${sql}`);
	}

	function applyStatement(stmt: PreparedStatement) {
		operations.push(stmt);
	}

	return {
		AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
		BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
		ASSETS: {
			fetch: () => new Response('Not Found', { status: 404 })
		},
		SPEECH_CACHE: {
			delete: async (key: string) => {
				deletedKeys.push(key);
				return true;
			},
			get: async () => null,
			put: async () => undefined,
			list: async () => ({ objects: [], truncated: false, cursor: '' })
		},
		DB: {
			prepare: (sql: string) => ({
				bind: (...args: unknown[]) => ({
					sql,
					args,
					first: async () => {
						const result = query(sql, args);
						return result.results[0] ?? null;
					},
					all: async () => query(sql, args)
				})
			}),
			batch: async (statements: PreparedStatement[]) => {
				for (const stmt of statements) {
					applyStatement(stmt);
				}
				return statements.map(() => ({ meta: { changes: 1 } }));
			}
		},
		__operations: operations,
		__deletedKeys: deletedKeys
	};
}

async function request(
	path: string,
	env: ReturnType<typeof createUploadEnv>,
	init?: RequestInit<IncomingRequestCfProperties>
) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res, ctx };
}

describe('upload_markdown PATCH', () => {
	it('preserves existing section IDs and invalidates the speeches list cache', async () => {
		const env = createUploadEnv();
		const body = [
			'# Demo Speech',
			'Alpha updated',
			'',
			'Inserted middle',
			'',
			'Beta'
		].join('\n');

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: body
			})
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			filename: 'demo-speech',
			sectionsCount: 3,
			insertedCount: 1,
			updatedCount: 2,
			deletedCount: 0
		});

		const updateSectionIds = env.__operations
			.filter((stmt) => stmt.sql.startsWith('UPDATE speech_content'))
			.map((stmt) => stmt.args[5]);
		const insertedSectionIds = env.__operations
			.filter((stmt) => stmt.sql.startsWith('INSERT INTO speech_content'))
			.map((stmt) => stmt.args[3]);

		expect(updateSectionIds).toEqual([100, 101]);
		expect(insertedSectionIds).toEqual([10001]);
		expect(env.__deletedKeys).toEqual(
			expect.arrayContaining([
				'v6/example.com/speeches',
				'v6/example.com/speeches/',
				'v6/example.com/rss.xml',
				'v6/example.com/feed.xml'
			])
		);
	});

	it('updates alternate links via PATCH without re-posting the speech', async () => {
		const env = createUploadEnv({ currentAlternateFilename: 'old-paired' });
		const body = [
			'# Demo Speech',
			'Alpha',
			'',
			'Beta'
		].join('\n');

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: body,
				alternate_filename: 'paired-speech'
			})
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			filename: 'demo-speech',
			alternate_filename: 'paired-speech',
			sectionsCount: 2,
			insertedCount: 0,
			updatedCount: 2,
			deletedCount: 0
		});

		const speechIndexOps = env.__operations.filter((stmt) => stmt.sql.startsWith('UPDATE speech_index'));
		expect(speechIndexOps.map((stmt) => [stmt.sql, stmt.args])).toEqual(
			expect.arrayContaining([
				[
					'UPDATE speech_index SET display_name = ?, alternate_filename = ? WHERE filename = ?',
					['Demo Speech', 'paired-speech', 'demo-speech']
				],
				[
					'UPDATE speech_index SET alternate_filename = NULL WHERE filename = ? AND alternate_filename = ?',
					['old-paired', 'demo-speech']
				],
				[
					'UPDATE speech_index SET alternate_filename = ? WHERE filename = ?',
					['demo-speech', 'paired-speech']
				]
			])
		);
		expect(env.__deletedKeys).toEqual(
			expect.arrayContaining([
				'v6/example.com/demo-speech',
				'v6/example.com/old-paired',
				'v6/example.com/paired-speech',
				'v6/example.com/speeches'
			])
		);
	});
});
