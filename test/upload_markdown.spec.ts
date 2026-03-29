import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type PreparedStatement = {
	sql: string;
	args: unknown[];
};

type SpeechIndexRow = {
	filename: string;
	display_name: string;
	isNested: number;
	nest_filenames: string;
	nest_display_names: string;
	alternate_filename?: string | null;
};

function createUploadEnv(options?: {
	currentAlternateFilename?: string | null;
	extraSpeechIndexRows?: SpeechIndexRow[];
}) {
	const operations: PreparedStatement[] = [];
	const deletedKeys: string[] = [];
	const putObjects = new Map<string, string>();
	const currentAlternateFilename = options?.currentAlternateFilename ?? null;

	const speechIndexRows: SpeechIndexRow[] = [
		{
			filename: 'demo-speech',
			display_name: 'Demo Speech',
			isNested: 0,
			nest_filenames: '',
			nest_display_names: '',
			alternate_filename: currentAlternateFilename
		},
		...(options?.extraSpeechIndexRows ?? [])
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
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) {
			return { success: true, results: [{ count: speechIndexRows.length }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) {
			return { success: true, results: [{ count: 0 }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) {
			return { success: true, results: [{ count: oldSections.length }] };
		}
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			return { success: true, results: speechIndexRows.filter((row) => row.filename === args[0]) };
		}
		if (sql.includes('SELECT MAX(section_id) AS max_id FROM speech_content')) {
			return { success: true, results: [{ max_id: oldSections[oldSections.length - 1]?.section_id ?? 0 }] };
		}
		if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
			return { success: true, results: args[0] === 'demo-speech' ? oldSections : [] };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
			if (args[0] === 'old-paired') {
				return { success: true, results: [{ section_id: 99001 }] };
			}
			if (args[0] === 'paired-speech') {
				return { success: true, results: [{ section_id: 99002 }] };
			}
			if (args[0] === 'fresh-speech') {
				return { success: true, results: [{ section_id: 200 }] };
			}
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
							name: null
						}
					]
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
					name: null
				}))
			};
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
					applyStatement(stmt);
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
				`${CACHE_KEY_VERSION}/example.com/speeches`,
				`${CACHE_KEY_VERSION}/example.com/speeches/`,
				`${CACHE_KEY_VERSION}/example.com/rss.xml`,
				`${CACHE_KEY_VERSION}/example.com/feed.xml`
			])
		);
		expect(env.__putObjects.get('search-updates/demo-speech.json')).toContain('"v":2');
		expect(env.__putObjects.get('search-index-manifest.json')).toContain('"demo-speech"');
		expect(env.__putObjects.get('stats.json')).toContain('"sections"');
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
				`${CACHE_KEY_VERSION}/example.com/demo-speech`,
				`${CACHE_KEY_VERSION}/example.com/old-paired`,
				`${CACHE_KEY_VERSION}/example.com/paired-speech`,
				`${CACHE_KEY_VERSION}/example.com/speeches`
			])
		);
	});
});

describe('upload_markdown POST', () => {
	it('invalidates the counterpart page when creating a new alternate-language pair', async () => {
		const env = createUploadEnv({
			extraSpeechIndexRows: [
				{
					filename: 'paired-speech',
					display_name: 'Paired Speech',
					isNested: 0,
					nest_filenames: '',
					nest_display_names: '',
					alternate_filename: null
				}
			]
		});

		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'fresh-speech',
				markdown: '# Fresh Speech\nAlpha',
				alternate_filename: 'paired-speech'
			})
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			filename: 'fresh-speech',
			sectionsCount: 1,
			alternate_filename: 'paired-speech'
		});
		expect(env.__deletedKeys).toEqual(
			expect.arrayContaining([
				`${CACHE_KEY_VERSION}/example.com/fresh-speech`,
				`${CACHE_KEY_VERSION}/example.com/paired-speech`,
				`${CACHE_KEY_VERSION}/example.com/speech/99002`,
				`${CACHE_KEY_VERSION}/example.com/speeches`
			])
		);
		expect(env.__putObjects.get('search-updates/fresh-speech.json')).toContain('"v":2');
		expect(env.__putObjects.get('search-index-manifest.json')).toContain('"fresh-speech"');
	});
});
