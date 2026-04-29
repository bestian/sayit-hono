import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { uploadMarkdown } from '../src/api/upload_markdown';
import type { Context } from 'hono';
import type { ApiEnv } from '../src/api/types';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function makeUploadEnv(resolver: Resolver, options: { batchChanges?: number[]; failSearchSync?: boolean } = {}) {
	const deletedKeys: string[] = [];
	const putObjects = new Map<string, string>();
	const operations: Array<{ sql: string; args: unknown[] }> = [];
	const directRuns: Array<{ sql: string; args: unknown[] }> = [];
	const changes = options.batchChanges ?? [];

	return {
		__deletedKeys: deletedKeys,
		__putObjects: putObjects,
		__operations: operations,
		__directRuns: directRuns,
		AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
		BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
		ASSETS: { fetch: () => new Response('NF', { status: 404 }) },
		SPEECH_CACHE: {
			delete: async (key: string) => {
				deletedKeys.push(key);
				return true;
			},
			get: async () => null,
			put: async (key: string, body: string) => {
				if (options.failSearchSync && (key.startsWith('search-updates/') || key === 'stats.json' || key === 'search-index-manifest.json')) {
					throw new Error('search sync failed');
				}
				putObjects.set(key, body);
			},
			list: async () => ({ objects: [], truncated: false, cursor: '' })
		},
		DB: {
			prepare: (sql: string) => {
				const run = (args: unknown[]) => ({
					sql,
					args,
					first: async () => resolver(sql, args).results[0] ?? null,
					all: async () => {
						const r = resolver(sql, args);
						return { success: r.success ?? true, results: r.results };
					},
					run: async () => {
						directRuns.push({ sql, args });
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
			batch: async (stmts: any[]) => {
				for (const stmt of stmts) operations.push({ sql: stmt.sql, args: stmt.args });
				return stmts.map((_, i) => ({ meta: { changes: changes[i] ?? 1 } }));
			}
		}
	};
}

async function request(path: string, env: ReturnType<typeof makeUploadEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('parseMarkdownSections edge branches', () => {
	it('quote-only section gets speaker=null', async () => {
		const env = makeUploadEnv((sql) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT MAX(section_id)')) return { success: true, results: [{ max_id: 100 }] };
			return { success: true, results: [] };
		});
		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'quote-demo',
				markdown: '# Quote Demo\n> a blockquote line\n> second quoted line'
			})
		});
		expect(res.status).toBe(200);
		// Section inserts — section_speaker should be null for quote-only sections
		const inserts = env.__operations.filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		expect(inserts.length).toBeGreaterThan(0);
		// Binding 7 (0-indexed 6) is section_speaker per the binding list
		const hasQuoteSpeakerNull = inserts.some((ins) => (ins.args as any[])[6] === null);
		expect(hasQuoteSpeakerNull).toBe(true);
	});

	it('drops empty speaker names (heading `## : ` with no name)', async () => {
		const env = makeUploadEnv((sql) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT MAX(section_id)')) return { success: true, results: [{ max_id: 200 }] };
			return { success: true, results: [] };
		});
		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'empty-speaker',
				markdown: '# Empty Speaker\n## :\nafter empty heading'
			})
		});
		expect(res.status).toBe(200);
		// No speakers inserted because the only speaker-line was empty
		const speakerInserts = env.__operations.filter((s) => s.sql.includes('INSERT INTO speakers'));
		expect(speakerInserts).toHaveLength(0);
	});
});

describe('orderSectionsByLinks and assignPatchedSections branches', () => {
	const oldSectionsResolver: Resolver = (sql, args) => {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			if (args[0] === 'circular') {
				return {
					success: true,
					results: [{ filename: 'circular', display_name: 'Circular', isNested: 0, alternate_filename: null }]
				};
			}
			return { success: true, results: [] };
		}
		if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
			// Return sections where every section has a prev that IS in the set
			// (no head) so orderSectionsByLinks falls back to sorted-by-id.
			return {
				success: true,
				results: [
					{ section_id: 10, previous_section_id: 20, next_section_id: 20, section_speaker: 'A', section_content: '<p>a</p>' },
					{ section_id: 20, previous_section_id: 10, next_section_id: 10, section_speaker: 'A', section_content: '<p>b</p>' }
				]
			};
		}
		if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
			return { success: true, results: [{ speaker_route_pathname: 'A' }] };
		}
		if (sql.includes('SELECT DISTINCT section_speaker')) {
			return { success: true, results: [{ section_speaker: 'A' }] };
		}
		if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
			return { success: true, results: [{ speaker_route_pathname: 'A' }] };
		}
		return { success: true, results: [] };
	};

	it('PATCH with circular-link old sections falls back to id-sort and completes', async () => {
		const env = makeUploadEnv(oldSectionsResolver);
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'circular',
				markdown: '# Circular\n## A:\nfresh body text'
			})
		});
		expect(res.status).toBe(200);
	});
});

describe('invalidateSpeakerCaches empty-route skip branch', () => {
	it('skips cache invalidation entries for empty/null speaker routes', async () => {
		// Construct a DELETE scenario where speech_speakers contains a row with null route_pathname.
		const env = makeUploadEnv((sql) => {
			if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return {
					success: true,
					results: [
						{ speaker_route_pathname: '' },
						{ speaker_route_pathname: null },
						{ speaker_route_pathname: 'valid-speaker' }
					]
				};
			}
			if (sql.includes('SELECT COUNT(*) AS count')) return { success: true, results: [{ count: 0 }] };
			return { success: true, results: [] };
		}, { batchChanges: [1, 1, 1] });
		const { res } = await request('/api/upload_markdown?filename=del-empty-speakers', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' }
		});
		expect(res.status).toBe(200);
		// valid-speaker URL should be among deleted keys
		expect(env.__deletedKeys.some((k) => k.includes('/speaker/valid-speaker'))).toBe(true);
	});
});

describe('syncSearchArtifacts error logging', () => {
	it('logs but does not fail upsert when the search sync rejects', async () => {
		const env = makeUploadEnv((sql) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT MAX(section_id)')) return { success: true, results: [{ max_id: 300 }] };
			return { success: true, results: [] };
		}, { failSearchSync: true });

		const { res } = await request('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'search-fail',
				markdown: '# Fail\n## A:\nhi'
			})
		});
		expect(res.status).toBe(200);
	});

	it('logs but does not fail delete when the search sync rejects', async () => {
		const env = makeUploadEnv((sql) => {
			if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT COUNT(*) AS count')) return { success: true, results: [{ count: 0 }] };
			return { success: true, results: [] };
		}, { failSearchSync: true });

		const { res } = await request('/api/upload_markdown?filename=del-search-fail', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' }
		});
		expect(res.status).toBe(200);
	});
});

describe('assignPatchedSections branches — many inserted sections', () => {
	function makeCtx(
		oldSections: any[],
		requestBody: { filename: string; markdown: string } = {
			filename: 'many-inserts',
			markdown: '# Many\n## A:\nA\n\nB\n\nC\n\nD\n\nE'
		}
	): { ctx: Context<ApiEnv>; ops: any[] } {
		const ops: any[] = [];
		const resolver: Resolver = (sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === requestBody.filename) {
					return {
						success: true,
						results: [{ filename: requestBody.filename, display_name: 'Many', isNested: 0, alternate_filename: null }]
					};
				}
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return { success: true, results: oldSections };
			}
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
				return { success: true, results: [{ speaker_route_pathname: 'A' }] };
			}
			if (sql.includes('SELECT DISTINCT section_speaker')) {
				return { success: true, results: [{ section_speaker: 'A' }] };
			}
			if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return { success: true, results: [{ speaker_route_pathname: 'A' }] };
			}
			return { success: true, results: [] };
		};

		const ctx = {
			env: {
				AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
				BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
				SPEECH_CACHE: {
					get: async () => null,
					put: async () => {},
					delete: async () => true,
					list: async () => ({ objects: [], truncated: false, cursor: '' })
				},
				DB: {
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
						for (const s of stmts) ops.push(s);
						return stmts.map(() => ({ meta: { changes: 1 } }));
					}
				}
			},
			req: {
				method: 'PATCH',
				url: 'https://example.com/api/upload_markdown',
				header: (name: string) => (name === 'Authorization' ? 'Bearer token-audrey' : null),
				query: () => null,
				json: async () => requestBody
			},
			json: (body: any, status = 200, headers: Record<string, string> = {}) =>
				new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }),
			text: (body: string, status = 200, headers: Record<string, string> = {}) =>
				new Response(body, { status, headers })
		} as unknown as Context<ApiEnv>;

		return { ctx, ops };
	}

	it('threads new sections into a short old list (tail-insertion with no LCS matches)', async () => {
		// Old list has 1 section with content that doesn't match new sections — LCS pairs is empty.
		// appendInsertedSections runs via the tail path (line 419) with baseIdHint derived from output.
		const { ctx } = makeCtx([
			{ section_id: 500, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>totally-different-old-content</p>' }
		]);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);
	});

	it('skips over an already-used generated section id inside an insertion gap', async () => {
		const { ctx, ops } = makeCtx(
			[
				{ section_id: 1, previous_section_id: null, next_section_id: 101, section_speaker: 'A', section_content: '<p>anchor one</p>' },
				{ section_id: 101, previous_section_id: 1, next_section_id: null, section_speaker: 'A', section_content: '<p>anchor two</p>' }
			],
			{
				filename: 'many-inserts',
				markdown: '# Many\n## A:\nanchor one\n\ninserted between\n\nanchor two'
			}
		);
		const res = await uploadMarkdown(ctx);
		expect(res.status).toBe(200);

		const insertedIds = ops
			.filter((stmt) => typeof stmt.sql === 'string' && stmt.sql.startsWith('INSERT INTO speech_content'))
			.map((stmt) => stmt.args[3]);
		expect(insertedIds).toContain(102);
	});
});

describe('PATCH treats svg / iframe blocks as match anchors (issue #68)', () => {
	function speakerResolver(filename: string, oldSections: any[]): Resolver {
		return (sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === filename) {
					return { success: true, results: [{ filename, display_name: filename, isNested: 0, alternate_filename: null }] };
				}
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return { success: true, results: oldSections };
			}
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
				return { success: true, results: [{ speaker_route_pathname: 'A' }] };
			}
			if (sql.includes('SELECT DISTINCT section_speaker')) {
				return { success: true, results: [{ section_speaker: 'A' }] };
			}
			if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return { success: true, results: [{ speaker_route_pathname: 'A' }] };
			}
			return { success: true, results: [] };
		};
	}

	it('preserves the svg section_id when prose is inserted before it and inner svg markup changes', async () => {
		// Without #68: LCS only matches the intro; gap-pairing makes the new prose inherit the svg's
		// old id, and the new svg is allocated a sub-id. With #68: svg is treated as an anchor in LCS,
		// so the new prose gets the sub-id and the svg keeps its original section_id.
		const oldSections = [
			{ section_id: 100, previous_section_id: null, next_section_id: 200, section_speaker: 'A', section_content: '<p>Intro paragraph here.</p>' },
			{ section_id: 200, previous_section_id: 100, next_section_id: null, section_speaker: 'A', section_content: '<svg viewBox="0 0 100 100"><title>Old Chart</title><circle/></svg>' }
		];
		const env = makeUploadEnv(speakerResolver('svg-anchor', oldSections));
		const newMarkdown = [
			'# svg-anchor',
			'## A:',
			'Intro paragraph here.',
			'',
			'Added explanation paragraph.',
			'',
			'<svg viewBox="0 0 200 200"><title>New Chart</title><rect/></svg>'
		].join('\n');
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'svg-anchor', markdown: newMarkdown })
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json).toMatchObject({
			sectionsCount: 3,
			insertedCount: 1,
			updatedCount: 2,
			deletedCount: 0
		});

		const updateOps = env.__operations.filter((s) => s.sql.startsWith('UPDATE speech_content'));
		const svgUpdate = updateOps.find((s) => (s.args as any[])[5] === 200);
		expect(svgUpdate).toBeDefined();
		const svgContent = (svgUpdate!.args as any[])[3] as string;
		expect(svgContent).toContain('<svg');
		expect(svgContent).toContain('New Chart');

		const insertOps = env.__operations.filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		const explanationInsert = insertOps.find((s) => {
			const content = (s.args as any[])[7];
			return typeof content === 'string' && content.includes('Added explanation');
		});
		expect(explanationInsert).toBeDefined();
		expect((explanationInsert!.args as any[])[3]).not.toBe(200);
	});

	it('preserves the iframe section_id when iframe src changes and an unrelated section is inserted', async () => {
		const oldSections = [
			{ section_id: 100, previous_section_id: null, next_section_id: 300, section_speaker: 'A', section_content: '<p>Lead-in sentence.</p>' },
			{ section_id: 300, previous_section_id: 100, next_section_id: null, section_speaker: 'A', section_content: '<iframe src="https://old.example.com/embed/abc"></iframe>' }
		];
		const env = makeUploadEnv(speakerResolver('iframe-anchor', oldSections));
		const newMarkdown = [
			'# iframe-anchor',
			'## A:',
			'Lead-in sentence.',
			'',
			'A note added between.',
			'',
			'<iframe src="https://new.example.com/embed/xyz"></iframe>'
		].join('\n');
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'iframe-anchor', markdown: newMarkdown })
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json).toMatchObject({ sectionsCount: 3, insertedCount: 1, updatedCount: 2, deletedCount: 0 });

		const updateOps = env.__operations.filter((s) => s.sql.startsWith('UPDATE speech_content'));
		const iframeUpdate = updateOps.find((s) => (s.args as any[])[5] === 300);
		expect(iframeUpdate).toBeDefined();
		const iframeContent = (iframeUpdate!.args as any[])[3] as string;
		expect(iframeContent).toContain('<iframe');
		expect(iframeContent).toContain('new.example.com');
	});

	it('does NOT short-circuit when a section mixes iframe with surrounding prose', async () => {
		// Mixed iframe+prose section: detectEmbeddedMediaTag finds the iframe but the
		// remainder after stripping is non-empty, so it returns null and the matcher
		// falls back to prose comparison. Single section → first-section special case
		// still preserves the id; this test exercises the remainder!=="" branch.
		const oldSections = [
			{ section_id: 50, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>Old prose around an iframe: <iframe src="A"></iframe> done.</p>' }
		];
		const env = makeUploadEnv(speakerResolver('mixed-iframe', oldSections));
		const newMarkdown = [
			'# mixed-iframe',
			'## A:',
			'New prose around an iframe: <iframe src="B"></iframe> done.'
		].join('\n');
		const { res } = await request('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'mixed-iframe', markdown: newMarkdown })
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json).toMatchObject({ sectionsCount: 1, updatedCount: 1, insertedCount: 0, deletedCount: 0 });
		const updateOps = env.__operations.filter((s) => s.sql.startsWith('UPDATE speech_content'));
		expect(updateOps.find((s) => (s.args as any[])[5] === 50)).toBeDefined();
	});
});
