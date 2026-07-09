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
		if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
			const start = (oldSections[oldSections.length - 1]?.section_id ?? 0) + 1;
			return { success: true, results: [{ next_id: start + Number(args[0] || 1) }] };
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
		if (sql.includes('FROM speech_speakers WHERE speech_filename = ?') || sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
			if (args[0] === 'demo-speech') {
				return { success: true, results: [{ speaker_route_pathname: 'ZOMBIE' }] };
			}
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT DISTINCT section_speaker')) {
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) {
			return { success: true, results: [] };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename != ?')) {
			return { success: true, results: [] };
		}
		throw new Error(`Unexpected query: ${sql}`);
	}

	function applyStatement(stmt: PreparedStatement) {
		if (typeof stmt.sql !== 'string') return;
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
			cachePurge: true, searchSync: true,
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
		expect(insertedSectionIds).toEqual([102]);
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
		expect(await res.json()).toEqual({ success: true, cachePurge: true, searchSync: true, filename: 'demo-speech',
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
			cachePurge: true, searchSync: true,
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


describe('upload_markdown PATCH deletes stale section caches', () => {
	it('purges deleted section R2 keys even when they are gone from D1', async () => {
		const operations: Array<{ sql: string; args: unknown[] }> = [];
		const deletedKeys: string[] = [];
		let liveSections = [
			{ section_id: 100, previous_section_id: null as number | null, next_section_id: 101 as number | null, section_speaker: null as string | null, section_content: '<p>Alpha</p>' },
			{ section_id: 101, previous_section_id: 100 as number | null, next_section_id: null as number | null, section_speaker: null as string | null, section_content: '<p>Beta</p>' }
		];

		function query(sql: string, args: unknown[]) {
			if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) {
				return { success: true, results: [{ count: 1 }] };
			}
			if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) {
				return { success: true, results: [{ count: 0 }] };
			}
			if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) {
				return { success: true, results: [{ count: liveSections.length }] };
			}
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				return {
					success: true,
					results: [{
						filename: 'demo-speech',
						display_name: 'Demo Speech',
						isNested: 0,
						nest_filenames: '',
						nest_display_names: '',
						alternate_filename: null
					}]
				};
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 200 }] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return {
					success: true,
					results: liveSections.map((s) => ({
						filename: 'demo-speech',
						...s
					}))
				};
			}
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
				// Post-mutation view: only remaining rows (simulates D1 after DELETE)
				return { success: true, results: liveSections.map(({ section_id }) => ({ section_id })) };
			}
			if (sql.includes('FROM speech_speakers')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT DISTINCT section_speaker')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_redirects')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename != ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index')) {
				return {
					success: true,
					results: liveSections.map((s) => ({
						filename: 'demo-speech',
						nest_filename: null,
						section_id: s.section_id,
						section_content: s.section_content,
						display_name: 'Demo Speech',
						name: null
					}))
				};
			}
			throw new Error(`Unexpected query: ${sql}`);
		}

		const env = {
			AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
			BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
			ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
			SPEECH_CACHE: {
				delete: async (key: string) => {
					deletedKeys.push(key);
					return true;
				},
				get: async () => null,
				put: async () => {},
				list: async () => ({ objects: [], truncated: false, cursor: '' })
			},
			DB: {
				prepare: (sql: string) => {
					const run = (args: unknown[] = []) => ({
						sql,
						args,
						first: async () => {
							if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
								return { next_id: 200 };
							}
							const result = query(sql, args);
							return result.results[0] ?? null;
						},
						all: async () => query(sql, args)
					});
					// Unbound prepare() must still carry sql for DB.batch([prepare(...)])
					return Object.assign(run([]), {
						bind: (...args: unknown[]) => run(args)
					});
				},
				batch: async (statements: Array<{ sql?: string; args?: unknown[] }>) => {
					for (const stmt of statements) {
						if (typeof stmt?.sql !== 'string') continue;
						operations.push({ sql: stmt.sql, args: stmt.args ?? [] });
						const args = stmt.args ?? [];
						if (stmt.sql.startsWith('DELETE FROM speech_content WHERE filename = ? AND section_id = ?')) {
							const id = Number(args[1]);
							liveSections = liveSections.filter((s) => s.section_id !== id);
						}
						if (stmt.sql.startsWith('UPDATE speech_content')) {
							// bind(previous, next, speaker, content, filename, section_id)
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
											section_content: content
										}
									: s
							);
						}
						if (stmt.sql.startsWith('INSERT INTO speech_content')) {
							liveSections.push({
								section_id: Number(args[3]),
								previous_section_id: (args[4] as number | null) ?? null,
								next_section_id: (args[5] as number | null) ?? null,
								section_speaker: (args[6] as string | null) ?? null,
								section_content: String(args[7])
							});
						}
					}
					return statements.map(() => ({ meta: { changes: 1 } }));
				}
			},
			__deletedKeys: deletedKeys
		} as any;

		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			// Keep only Alpha → section 101 must be deleted and purged
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo Speech\nAlpha only'
			})
		});

		expect(res.status).toBe(200);
		const body = await res.json() as { deletedCount: number };
		expect(body.deletedCount).toBe(1);
		expect(deletedKeys).toEqual(
			expect.arrayContaining([
				`${CACHE_KEY_VERSION}/example.com/speech/101`,
				`${CACHE_KEY_VERSION}/og/speech/101.png`,
				// remaining section still purged too
				`${CACHE_KEY_VERSION}/example.com/speech/100`,
				`${CACHE_KEY_VERSION}/og/speech/100.png`
			])
		);
		// Ensure we actually removed 101 from live D1 view before invalidate re-query
		expect(liveSections.map((s) => s.section_id)).toEqual([100]);
	});
});

describe('upload_markdown DELETE purges preexisting section caches', () => {
	it('purges section R2 keys captured before speech_content rows are deleted', async () => {
		const deletedKeys: string[] = [];
		let liveSections = [
			{ section_id: 42, previous_section_id: null as number | null, next_section_id: null as number | null, section_speaker: null as string | null, section_content: '<p>Only</p>' }
		];
		let speechExists = true;

		function query(sql: string, args: unknown[]) {
			if (sql.includes('FROM speech_redirects')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?') || sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
				return { success: true, results: liveSections.map(({ section_id }) => ({ section_id })) };
			}
			if (sql.includes('SELECT COUNT(*) AS count')) {
				return { success: true, results: [{ count: 0 }] };
			}
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				return {
					success: true,
					results: speechExists
						? [{ filename: 'demo-speech', display_name: 'Demo', isNested: 0, nest_filenames: '', nest_display_names: '', alternate_filename: null }]
						: []
				};
			}
			throw new Error(`Unexpected query: ${sql}`);
		}

		const env = {
			AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
			BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
			ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
			SPEECH_CACHE: {
				delete: async (key: string) => {
					deletedKeys.push(key);
					return true;
				},
				get: async () => null,
				put: async () => {},
				list: async () => ({ objects: [], truncated: false, cursor: '' })
			},
			DB: {
				prepare: (sql: string) => {
					const run = (args: unknown[] = []) => ({
						sql,
						args,
						first: async () => query(sql, args).results[0] ?? null,
						all: async () => query(sql, args)
					});
					return Object.assign(run([]), {
						bind: (...args: unknown[]) => run(args)
					});
				},
				batch: async (statements: Array<{ sql?: string; args?: unknown[]; meta?: { changes: number } }>) => {
					for (const stmt of statements) {
						if (typeof stmt?.sql !== 'string') continue;
						if (stmt.sql.startsWith('DELETE FROM speech_content WHERE filename = ?')) {
							liveSections = [];
						}
						if (stmt.sql.startsWith('DELETE FROM speech_index WHERE filename = ?')) {
							speechExists = false;
						}
					}
					return statements.map((stmt) => {
						const sql = stmt?.sql ?? '';
						// Report real-looking change counts so DELETE does not 404
						if (sql.startsWith('DELETE FROM speech_content')) return { meta: { changes: 1 } };
						if (sql.startsWith('DELETE FROM speech_speakers')) return { meta: { changes: 0 } };
						if (sql.startsWith('DELETE FROM speech_index')) return { meta: { changes: 1 } };
						return { meta: { changes: 0 } };
					});
				}
			}
		} as any;

		const { res } = await request('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' }
		});
		expect(res.status).toBe(200);
		expect(deletedKeys).toEqual(
			expect.arrayContaining([
				`${CACHE_KEY_VERSION}/example.com/speech/42`,
				`${CACHE_KEY_VERSION}/og/speech/42.png`,
				`${CACHE_KEY_VERSION}/example.com/demo-speech`,
				'an/demo-speech',
				'md/demo-speech'
			])
		);
		expect(liveSections).toEqual([]);
	});
});



describe('invalidateSpeechCaches section query failure', () => {
	it('still returns success when section_id re-query throws after PATCH', async () => {
		const env = createUploadEnv();
		const originalPrepare = env.DB.prepare.bind(env.DB);
		let patchDone = false;
		env.DB.prepare = (sql: string) => {
			const stmt = originalPrepare(sql);
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
				return {
					bind: (...args: unknown[]) => ({
						first: async () => {
							throw new Error('section re-query failed');
						},
						all: async () => {
							throw new Error('section re-query failed');
						},
						sql,
						args
					}),
					first: async () => {
						throw new Error('section re-query failed');
					},
					all: async () => {
						throw new Error('section re-query failed');
					}
				} as any;
			}
			return stmt;
		};
		// Force invalidate path: normal PATCH
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo Speech\nAlpha\n\nBeta'
			})
		});
		// D1 wrote; section re-query fail is swallowed inside invalidate; purge may still succeed
		expect([200, 503]).toContain(res.status);
	});
});


describe('upload_markdown cachePurge failures', () => {
	it('returns 503 when cache purge fails after PATCH', async () => {
		const { cache } = await import('cloudflare:workers');
		const purge = cache.purge as ReturnType<typeof import('vitest').vi.fn>;
		purge.mockResolvedValue({ success: false });

		const env = createUploadEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo Speech\nAlpha\n\nBeta'
			})
		});
		expect(res.status).toBe(503);
		const json = await res.json() as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(false);
	});
});


describe('upload_markdown cachePurge failures for DELETE/POST', () => {
	it('returns 503 when cache purge fails after DELETE', async () => {
		const { cache } = await import('cloudflare:workers');
		const purge = cache.purge as ReturnType<typeof import('vitest').vi.fn>;
		purge.mockResolvedValue({ success: false });

		// Reuse delete-style env from createUploadEnv is weak; use lightweight env
		const deletedKeys: string[] = [];
		let liveSections = [{ section_id: 1 }];
		const env = {
			AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
			BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
			ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
			SPEECH_CACHE: {
				delete: async (key: string) => { deletedKeys.push(key); return true; },
				get: async () => null,
				put: async () => {},
				list: async () => ({ objects: [], truncated: false, cursor: '' })
			},
			DB: {
				prepare: (sql: string) => {
					const run = (args: unknown[] = []) => ({
						sql,
						args,
						first: async () => null,
						all: async () => {
							if (sql.includes('FROM speech_redirects')) return { success: true, results: [] };
							if (sql.includes('speech_speakers')) return { success: true, results: [] };
							if (sql.includes('SELECT section_id FROM speech_content')) {
								return { success: true, results: liveSections.map((s) => ({ section_id: s.section_id })) };
							}
							return { success: true, results: [] };
						}
					});
					return Object.assign(run([]), { bind: (...args: unknown[]) => run(args) });
				},
				batch: async (statements: Array<{ sql?: string }>) => {
					for (const stmt of statements) {
						if (stmt.sql?.startsWith('DELETE FROM speech_content WHERE filename = ?')) liveSections = [];
					}
					return statements.map((stmt) => {
						const sql = stmt.sql ?? '';
						if (sql.startsWith('DELETE FROM speech_content')) return { meta: { changes: 1 } };
						if (sql.startsWith('DELETE FROM speech_index')) return { meta: { changes: 1 } };
						return { meta: { changes: 0 } };
					});
				}
			}
		} as any;

		const { res } = await request('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' }
		});
		expect(res.status).toBe(503);
		const json = await res.json() as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(false);
		expect(json.searchSync).toBe(false);
	});

	it('returns 503 when cache purge fails after POST', async () => {
		const { cache } = await import('cloudflare:workers');
		const purge = cache.purge as ReturnType<typeof import('vitest').vi.fn>;
		purge.mockResolvedValue({ success: false });
		const env = createUploadEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'brand-new-speech',
				markdown: '# Brand New\n## Speaker:\nhello'
			})
		});
		expect(res.status).toBe(503);
		const json = await res.json() as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(false);
		expect(json.searchSync).toBe(false);
	});

	it('POST replace prefetches prior speakers and cleans orphans', async () => {
		const env = createUploadEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				// Same title as existing display_name so no collision rename; no speaker on sections
				markdown: '# Demo Speech\nOnly body no speaker mark'
			})
		});
		expect([200, 503]).toContain(res.status);
		const orphanDeletes = env.__operations.filter((s) =>
			s.sql.includes('DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS')
			&& s.args[0] === 'ZOMBIE'
		);
		expect(orphanDeletes.length).toBeGreaterThan(0);
	});
});


describe('upload_markdown defensive branches', () => {
	it('covers null section_content and non-Error catch', async () => {
		// 1) PATCH with null section_content on old rows
		const env = createUploadEnv();
		const originalPrepare = env.DB.prepare.bind(env.DB);
		env.DB.prepare = (sql: string) => {
			const stmt = originalPrepare(sql);
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return {
					bind: (...args: unknown[]) => ({
						sql,
						args,
						first: async () => null,
						all: async () => ({
							success: true,
							results: [
								{
									section_id: 100,
									previous_section_id: null,
									next_section_id: 101,
									section_speaker: null,
									section_content: null
								},
								{
									section_id: 101,
									previous_section_id: 100,
									next_section_id: null,
									section_speaker: null,
									section_content: null
								}
							]
						})
					}),
					first: async () => null,
					all: async () => ({ success: true, results: [] })
				} as any;
			}
			return stmt;
		};

		const ok = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo Speech\nAlpha\n\nBeta'
			})
		});
		expect([200, 503]).toContain(ok.res.status);

		// 2) non-Error throw path in outer catch
		const boomEnv = createUploadEnv();
		boomEnv.DB.prepare = () => {
			throw 'string-boom';
		};
		const bad = await request('/api/upload_markdown', boomEnv, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo Speech\nAlpha'
			})
		});
		expect(bad.res.status).toBe(503);
		const json = await bad.res.json() as { detail: string };
		expect(json.detail).toContain('string-boom');
	});
});


describe('upload_markdown PATCH empty result containers', () => {
	it('handles undefined results arrays on PATCH load', async () => {
		const env = createUploadEnv();
		const originalPrepare = env.DB.prepare.bind(env.DB);
		env.DB.prepare = (sql: string) => {
			const stmt = originalPrepare(sql);
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return {
					bind: () => ({
						first: async () => null,
						all: async () => ({ success: true }) // results undefined
					}),
					first: async () => null,
					all: async () => ({ success: true })
				} as any;
			}
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?') || sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return {
					bind: () => ({
						first: async () => null,
						all: async () => ({ success: true }) // results undefined
					}),
					first: async () => null,
					all: async () => ({ success: true })
				} as any;
			}
			return stmt;
		};
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo Speech\nOnly one section'
			})
		});
		expect([200, 503]).toContain(res.status);
	});
});


describe('upload_markdown R2 origin delete failures', () => {
	it('returns 503 when R2 origin delete fails after PATCH even if Workers purge succeeds', async () => {
		const env = createUploadEnv();
		env.SPEECH_CACHE.delete = async () => {
			throw new Error('r2 delete failed');
		};
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo Speech\nAlpha\n\nBeta'
			})
		});
		expect(res.status).toBe(503);
		const json = await res.json() as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(false);
		expect(json.searchSync).toBe(true);
	});
});


describe('upload_markdown search artifact sync failures', () => {
	it('returns 503 when search overlay sync fails after PATCH', async () => {
		const env = createUploadEnv();
		const originalPut = env.SPEECH_CACHE.put.bind(env.SPEECH_CACHE);
		env.SPEECH_CACHE.put = async (key: string, body: string) => {
			if (String(key).startsWith('search-updates/') || key === 'stats.json' || key === 'search-index-manifest.json') {
				throw new Error('search r2 write failed');
			}
			return originalPut(key, body);
		};
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: {
				Authorization: 'Bearer token-audrey',
				'Content-Type': 'application/json; charset=utf-8'
			},
			body: JSON.stringify({
				filename: 'demo-speech',
				markdown: '# Demo Speech\nAlpha\n\nBeta'
			})
		});
		expect(res.status).toBe(503);
		const json = await res.json() as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(true);
		expect(json.searchSync).toBe(false);
	});
});
