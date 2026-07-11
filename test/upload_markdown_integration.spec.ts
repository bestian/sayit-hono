/**
 * HTTP-level integration tests for /api/upload_markdown and /api/purge_cache.
 *
 * Covers routing by verb (GET/POST/PATCH/DELETE), auth/token gating, status
 * codes, error responses, and request/response shape. Env/mock construction
 * uses the shared createMockEnv/dispatch helper from test/helpers/mockEnv.ts;
 * per-test SQL-matching resolver logic stays inline.
 */
import { describe, expect, it } from 'vitest';
// vi.mock in setup-cache-isolation.ts hoists this; static import is fine.
import { cache as workersCache } from 'cloudflare:workers';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import { createMockEnv, dispatch } from './helpers/mockEnv';
import type { MockWorkerEnv, PreparedStatement, QueryResolver } from './helpers/mockEnv';

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
// Shared resolver helpers (local to this file — domain SQL, not env shape)
// ---------------------------------------------------------------------------

type SpeechIndexRow = {
	filename: string;
	display_name: string;
	isNested: number;
	nest_filenames: string;
	nest_display_names: string;
	alternate_filename?: string | null;
};

/**
 * Builds a resolver for the "standard demo-speech" scenario: two existing
 * sections (100, 101), one speech_index row, ZOMBIE orphan speaker.
 * Many integration tests start from this shape and tweak options.
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

/** Resolver for POST new-speech creation — no existing rows by default. */
function postNewSpeechResolver(options: { hasExistingFilename?: boolean; redirects?: Record<string, string> } = {}): QueryResolver {
	const redirects = options.redirects ?? {};
	return (sql, args) => {
		if (sql.includes('FROM speech_index WHERE filename = ?')) {
			if (options.hasExistingFilename && args[0] === 'new-speech')
				return { success: true, results: [{ filename: 'new-speech', display_name: 'new-speech' }] };
			return { success: true, results: [] };
		}
		if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
			return { success: true, results: [{ next_id: 1001 + Number(args[0] || 1) }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) return { success: true, results: [{ count: 1 }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) return { success: true, results: [{ count: 1 }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) return { success: true, results: [{ count: 2 }] };
		if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename'))
			return { success: true, results: [] };
		if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) return { success: true, results: [] };
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) return { success: true, results: [] };
		if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) {
			const target = redirects[String(args[0])];
			return { success: true, results: target ? [{ new_filename: target }] : [] };
		}
		return { success: true, results: [] };
	};
}

/** Resolver for DELETE — returns speaker routes and section ids for the given filename. */
function deleteResolver(options: { speakerRoutes?: string[]; redirects?: Record<string, string> } = {}): QueryResolver {
	const speakerRoutes = options.speakerRoutes ?? ['audrey-tang', 'bestian'];
	const redirects = options.redirects ?? {};
	return (sql, args) => {
		if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers'))
			return { success: true, results: speakerRoutes.map((r) => ({ speaker_route_pathname: r })) };
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) return { success: true, results: [{ count: 0 }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) return { success: true, results: [{ count: 0 }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) return { success: true, results: [{ count: 0 }] };
		if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) {
			const target = redirects[String(args[0])];
			return { success: true, results: target ? [{ new_filename: target }] : [] };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?'))
			return { success: true, results: [{ section_id: 100 }, { section_id: 101 }] };
		return { success: true, results: [] };
	};
}

/** Resolver for PATCH upsert — speech_index rows, redirects, no old sections. */
function upsertResolver(options: { speechIndexRows?: SpeechIndexRow[]; redirects?: Record<string, string> } = {}): QueryResolver {
	const speechIndexRows = options.speechIndexRows ?? [];
	const redirects = options.redirects ?? {};
	return (sql, args) => {
		if (sql.includes('FROM speech_index WHERE filename = ?'))
			return { success: true, results: speechIndexRows.filter((row) => row.filename === args[0]) };
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) return { success: true, results: [{ count: speechIndexRows.length }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) return { success: true, results: [{ count: 0 }] };
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) return { success: true, results: [{ count: 0 }] };
		if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
			return { success: true, results: [{ next_id: 501 + Number(args[0] || 1) }] };
		if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: [] };
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) return { success: true, results: [] };
		if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si ON sc.filename = si.filename'))
			return { success: true, results: [] };
		if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) return { success: true, results: [] };
		if (sql.includes('SELECT DISTINCT section_speaker')) return { success: true, results: [] };
		if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) return { success: true, results: [] };
		if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) {
			const target = redirects[String(args[0])];
			return { success: true, results: target ? [{ new_filename: target }] : [] };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename != ?')) return { success: true, results: [] };
		return { success: true, results: [] };
	};
}

/** Resolver that always returns empty results — for auth/error tests where DB should not be queried. */
function emptyResolver(): QueryResolver {
	return () => ({ success: true, results: [] });
}

/** Resolver that always throws — simulates DB failure. */
function failingResolver(): QueryResolver {
	return () => {
		throw new Error('retry me');
	};
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

const mutationMethods = ['POST', 'PATCH', 'DELETE'] as const;

describe('/api/upload_markdown — auth gate', () => {
	for (const method of mutationMethods) {
		describe(method, () => {
			const path = method === 'DELETE' ? '/api/upload_markdown?filename=x' : '/api/upload_markdown';
			const body = method === 'DELETE' ? undefined : JSON.stringify({ filename: 'x', markdown: '# x\ny' });
			const contentType = method === 'DELETE' ? undefined : 'application/json; charset=utf-8';

			it('rejects missing Authorization header with 400', async () => {
				const env = createMockEnv(emptyResolver());
				const { res } = await dispatch(path, env, {
					method,
					headers: contentType ? { 'Content-Type': contentType } : {},
					body,
				});
				expect(res.status).toBe(400);
			});

			it('rejects non-Bearer scheme with 400', async () => {
				const env = createMockEnv(emptyResolver());
				const { res } = await dispatch(path, env, {
					method,
					headers: {
						Authorization: 'Basic token-audrey',
						...(contentType ? { 'Content-Type': contentType } : {}),
					},
					body,
				});
				expect(res.status).toBe(400);
			});

			it('rejects unknown token with 400', async () => {
				const env = createMockEnv(emptyResolver());
				const { res } = await dispatch(path, env, {
					method,
					headers: {
						Authorization: 'Bearer not-a-real-token',
						...(contentType ? { 'Content-Type': contentType } : {}),
					},
					body,
				});
				expect(res.status).toBe(400);
			});

			it('rejects empty Bearer with 400', async () => {
				const env = createMockEnv(emptyResolver());
				const { res } = await dispatch(path, env, {
					method,
					headers: {
						Authorization: 'Bearer ',
						...(contentType ? { 'Content-Type': contentType } : {}),
					},
					body,
				});
				expect(res.status).toBe(400);
			});
		});
	}
});

describe('/api/purge_cache — auth gate', () => {
	it('rejects missing Authorization with 403', async () => {
		const env = createMockEnv(emptyResolver());
		const { res } = await dispatch('/api/purge_cache', env, { method: 'POST' });
		expect(res.status).toBe(403);
	});

	it('rejects unknown token with 403', async () => {
		const env = createMockEnv(emptyResolver());
		const { res } = await dispatch('/api/purge_cache', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer wrong' },
		});
		expect(res.status).toBe(403);
	});

	it('rejects non-Bearer scheme with 403', async () => {
		const env = createMockEnv(emptyResolver());
		const { res } = await dispatch('/api/purge_cache', env, {
			method: 'POST',
			headers: { Authorization: 'Basic token-audrey' },
		});
		expect(res.status).toBe(403);
	});
});

// ---------------------------------------------------------------------------
// Unsupported method and error responses
// ---------------------------------------------------------------------------

describe('upload_markdown — unsupported method', () => {
	it('returns 404 for PUT (not POST/PATCH/DELETE)', async () => {
		const env = createMockEnv(emptyResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PUT',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'x', markdown: 'y' }),
		});
		expect(res.status).toBe(404);
	});

	it('returns 400 for invalid JSON on PATCH', async () => {
		const env = createMockEnv(emptyResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: '{not json',
		});
		expect(res.status).toBe(400);
	});

	it('returns 400 when PATCH is missing filename', async () => {
		const env = createMockEnv(emptyResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ markdown: '# x\ny' }),
		});
		expect(res.status).toBe(400);
	});

	it('returns 400 when PATCH is missing markdown', async () => {
		const env = createMockEnv(emptyResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'x' }),
		});
		expect(res.status).toBe(400);
	});
});

describe('upload_markdown — 503 on DB failure', () => {
	it('returns 503 with Retry-After when DB retry ultimately fails', async () => {
		const env = createMockEnv(failingResolver());
		const { res } = await dispatch('/api/upload_markdown?filename=demo', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(503);
		expect(res.headers.get('Retry-After')).toBe('2');
	}, 15000);
});

// ---------------------------------------------------------------------------
// POST — new speech creation
// ---------------------------------------------------------------------------

describe('POST /api/upload_markdown — new speech creation', () => {
	it('creates speech_index, speakers (ON CONFLICT), speech_speakers, and speech_content', async () => {
		const env = createMockEnv(postNewSpeechResolver());
		const markdown = ['# New Speech', '## Audrey Tang:', 'Hello world.', '', '## Bestian:', 'Another paragraph.'].join('\n');
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'new-speech', markdown }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; filename: string; sectionsCount: number };
		expect(json).toEqual({ success: true, cachePurge: true, searchSync: true, filename: 'new-speech', sectionsCount: 2 });

		const indexInsert = boundStmts(env).find((s) => s.sql.startsWith('INSERT INTO speech_index'));
		expect(indexInsert).toBeDefined();
		expect(indexInsert!.args[0]).toBe('new-speech');
		expect(indexInsert!.args[1]).toBe('New Speech');

		const speakerUpserts = boundStmts(env).filter((s) => s.sql.includes('INSERT INTO speakers'));
		expect(speakerUpserts.length).toBe(2);
		expect(speakerUpserts.map((s) => s.args[0])).toEqual(expect.arrayContaining(['Audrey%20Tang', 'Bestian']));
		expect(speakerUpserts[0].sql).toContain('ON CONFLICT');

		const speechSpeakersLinks = boundStmts(env).filter((s) => s.sql.includes('INSERT OR IGNORE INTO speech_speakers'));
		expect(speechSpeakersLinks.length).toBe(2);
		expect(speechSpeakersLinks.map((s) => s.args)).toEqual(
			expect.arrayContaining([
				['new-speech', 'Audrey%20Tang'],
				['new-speech', 'Bestian'],
			]),
		);

		const contentInserts = boundStmts(env).filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		expect(contentInserts.length).toBeGreaterThan(0);
	});

	it('rewrites filename via speech_redirects when speech_index misses, treating canonical as the existing target', async () => {
		const env = createMockEnv(postNewSpeechResolver({ redirects: { 'deprecated-name': 'canonical-name' } }));
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'deprecated-name', markdown: '# Canonical\n## A:\nHi' }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { filename: string };
		expect(json.filename).toBe('canonical-name');
		const indexInsert = boundStmts(env).find((s) => s.sql.startsWith('INSERT INTO speech_index'));
		expect(indexInsert!.args[0]).toBe('canonical-name');
	});

	it('deletes prior rows before re-inserting when filename already exists (idempotent)', async () => {
		const env = createMockEnv(postNewSpeechResolver({ hasExistingFilename: true }));
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'new-speech', markdown: '# New\n## A:\nHi' }),
		});
		expect(res.status).toBe(200);
		const deleteContent = boundStmts(env).find((s) => s.sql.startsWith('DELETE FROM speech_content'));
		const deleteRelations = boundStmts(env).find((s) => s.sql.startsWith('DELETE FROM speech_speakers'));
		const deleteIndex = boundStmts(env).find((s) => s.sql.startsWith('DELETE FROM speech_index'));
		expect(deleteContent).toBeDefined();
		expect(deleteRelations).toBeDefined();
		expect(deleteIndex).toBeDefined();
	});

	it('invalidates speech, speakers, and list-page caches', async () => {
		const env = createMockEnv(postNewSpeechResolver());
		await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'new-speech', markdown: '# New\n## A:\nHi' }),
		});
		// R2 deletes are derivable from __r2Store: a key that was deleted is absent.
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/new-speech`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speaker/A`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speakers`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speeches`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/rss.xml`)).toBe(false);
	});

	it('rejects missing filename with 400', async () => {
		const env = createMockEnv(postNewSpeechResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ markdown: '# X\nY' }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects missing markdown with 400', async () => {
		const env = createMockEnv(postNewSpeechResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'x' }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects invalid JSON body with 400', async () => {
		const env = createMockEnv(postNewSpeechResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: '{not json',
		});
		expect(res.status).toBe(400);
	});

	it('strips <script> tags from section content (XSS guard)', async () => {
		const env = createMockEnv(postNewSpeechResolver());
		await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'new-speech', markdown: '# Title\n## A:\nHello <script>alert(1)</script> world' }),
		});
		const contentInserts = boundStmts(env).filter((s) => s.sql.startsWith('INSERT INTO speech_content'));
		const allContent = contentInserts.flatMap((s) => s.args).join('\n');
		expect(allContent).not.toContain('<script>');
		expect(allContent).not.toContain('alert(1)');
	});

	it('creates bidirectional alternate_filename link', async () => {
		const env = createMockEnv(postNewSpeechResolver());
		await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'new-speech', markdown: '# New\n## A:\nHi', alternate_filename: 'paired-speech' }),
		});
		const altUpdates = boundStmts(env).filter((s) => s.sql.includes('UPDATE speech_index SET alternate_filename'));
		expect(altUpdates.length).toBe(2);
		expect(altUpdates.map((s) => s.args)).toEqual(
			expect.arrayContaining([
				['paired-speech', 'new-speech'],
				['new-speech', 'paired-speech'],
			]),
		);
	});
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('DELETE /api/upload_markdown', () => {
	it('issues delete batch with content, relations, index, and orphan cleanup', async () => {
		const env = createMockEnv(deleteResolver({ speakerRoutes: ['audrey-tang', 'bestian'] }));
		const { res } = await dispatch('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; deleted: Record<string, number> };
		expect(json.success).toBe(true);
		expect(json.deleted).toEqual({ sections: 1, relations: 1, speakers: 2, speech: 1 });

		const batchSqls = boundStmts(env).map((s) => s.sql.trim().split('\n')[0].trim());
		expect(batchSqls[0]).toContain('DELETE FROM speech_content');
		expect(batchSqls[1]).toContain('DELETE FROM speech_speakers');
		expect(batchSqls[2]).toContain('DELETE FROM speech_index');
		expect(
			boundStmts(env)
				.slice(3)
				.map((s) => s.sql),
		).toEqual([expect.stringContaining('DELETE FROM speakers'), expect.stringContaining('DELETE FROM speakers')]);
		expect(
			boundStmts(env)
				.slice(3)
				.map((s) => s.args[0]),
		).toEqual(['audrey-tang', 'bestian']);
	});

	it('invalidates speech, speaker, and list-page R2 caches', async () => {
		const env = createMockEnv(deleteResolver({ speakerRoutes: ['audrey-tang'] }));
		await dispatch('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/demo-speech`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speaker/audrey-tang`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speeches`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/speakers`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/rss.xml`)).toBe(false);
		expect(env.__r2Store.has(`${CACHE_KEY_VERSION}/example.com/`)).toBe(false);
	});

	it('returns 404 when no rows match', async () => {
		// Override batch to simulate no-op: all changes = 0
		const env = createMockEnv(deleteResolver({ speakerRoutes: [] }));
		env.DB.batch = async (statements: PreparedStatement[]) => {
			for (const stmt of statements) env.__batchedStatements.push(stmt);
			return statements.map(() => ({ meta: { changes: 0 } }));
		};
		const { res } = await dispatch('/api/upload_markdown?filename=ghost', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(404);
	});

	it('rewrites filename via speech_redirects to the canonical target before deleting', async () => {
		const env = createMockEnv(deleteResolver({ speakerRoutes: ['audrey-tang'], redirects: { 'deprecated-name': 'canonical-name' } }));
		const { res } = await dispatch('/api/upload_markdown?filename=deprecated-name', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(200);
		const deleteContent = boundStmts(env).find((s) => s.sql.startsWith('DELETE FROM speech_content'));
		expect(deleteContent!.args[0]).toBe('canonical-name');
		const deleteIndex = boundStmts(env).find((s) => s.sql.startsWith('DELETE FROM speech_index'));
		expect(deleteIndex!.args[0]).toBe('canonical-name');
	});

	it('returns 400 when filename query param is missing', async () => {
		const env = createMockEnv(deleteResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(400);
	});

	it('returns 400 when filename query param is only whitespace', async () => {
		const env = createMockEnv(emptyResolver());
		const { res } = await dispatch('/api/upload_markdown?filename=%20%20%20', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(400);
	});

	it('marks speech deleted in search manifest and deletes overlay key', async () => {
		const env = createMockEnv(deleteResolver({ speakerRoutes: ['audrey-tang'] }));
		await dispatch('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		const manifestWrite = env.__r2Store.get('search-index-manifest.json');
		expect(manifestWrite).toBeDefined();
		expect(manifestWrite?.body).toContain('"deleted":true');
		expect(env.__r2Store.has('search-updates/demo-speech.json')).toBe(false);
		expect(env.__r2Store.get('stats.json')?.body).toContain('"sections"');
	});
});

// ---------------------------------------------------------------------------
// PATCH — upsert when filename missing
// ---------------------------------------------------------------------------

describe('PATCH /api/upload_markdown — upsert when filename missing', () => {
	it('auto-creates speech_index row and returns 200', async () => {
		const env = createMockEnv(upsertResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'fresh-speech', markdown: '# Fresh Speech\nHello world' }),
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
		const env = createMockEnv(
			upsertResolver({
				redirects: { 'deprecated-filename': 'canonical-filename' },
				speechIndexRows: [
					{
						filename: 'canonical-filename',
						display_name: 'Canonical',
						isNested: 0,
						nest_filenames: '',
						nest_display_names: '',
						alternate_filename: null,
					},
				],
			}),
		);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'deprecated-filename', markdown: '# Canonical\nContent' }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; filename: string };
		expect(json.success).toBe(true);
		expect(json.filename).toBe('canonical-filename');
		const insertStmt = env.__directStatements.find((s) => s.sql.includes('INSERT INTO speech_index'));
		expect(insertStmt).toBeUndefined();
	});

	it('does NOT call the upsert insert when row already exists', async () => {
		const env = createMockEnv(
			upsertResolver({
				speechIndexRows: [
					{
						filename: 'existing-speech',
						display_name: 'Existing',
						isNested: 0,
						nest_filenames: '',
						nest_display_names: '',
						alternate_filename: null,
					},
				],
			}),
		);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'existing-speech', markdown: '# Existing\nNew content' }),
		});
		expect(res.status).toBe(200);
		const insertStmt = env.__directStatements.find((s) => s.sql.includes('INSERT INTO speech_index'));
		expect(insertStmt).toBeUndefined();
	});

	it('rejects alternate_filename === filename with 400', async () => {
		const env = createMockEnv(
			upsertResolver({
				speechIndexRows: [
					{ filename: 'dup', display_name: 'Dup', isNested: 0, nest_filenames: '', nest_display_names: '', alternate_filename: null },
				],
			}),
		);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'dup', markdown: '# X\nY', alternate_filename: 'dup' }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects non-string alternate_filename with 400', async () => {
		const env = createMockEnv(
			upsertResolver({
				speechIndexRows: [
					{ filename: 'x', display_name: 'X', isNested: 0, nest_filenames: '', nest_display_names: '', alternate_filename: null },
				],
			}),
		);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'x', markdown: '# X\nY', alternate_filename: 123 }),
		});
		expect(res.status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// reserveSectionIds failure
// ---------------------------------------------------------------------------

describe('reserveSectionIds failure handling', () => {
	it('returns 503 when the counter reservation returns no row', async () => {
		// Every query resolves to an empty result set, so the counter
		// UPDATE ... RETURNING .first() returns null -> reserveSectionIds throws.
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'no-counter', markdown: '# Title\n\nhello world' }),
		});
		expect(res.status).toBe(503);
	});
});

// ---------------------------------------------------------------------------
// Filename truncation clobber guard
// ---------------------------------------------------------------------------

const RAW_B = '2026-03-05-good-enough-gardeners-must-harness-ai-to-survive.md';
const norm = (s: string) => s.toLowerCase().replace(/\.md$/, '').replace(/：/g, '-');
const LEGACY_KEY = norm(RAW_B).slice(0, 50);
const RESISTANT_PREFIX = norm(RAW_B).slice(0, 42);

describe('filename truncation clobber guard', () => {
	it('POST gives a collision-resistant key instead of clobbering a different-titled speech', async () => {
		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 1001 + Number(args[0] || 1) }] };
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === LEGACY_KEY) return { success: true, results: [{ filename: LEGACY_KEY, display_name: 'Gardeners — thrive' }] };
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: RAW_B, markdown: '# Gardeners — survive\n\nthe other speech' }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { filename: string };
		expect(body.filename).not.toBe(LEGACY_KEY);
		expect(body.filename.length).toBeLessThanOrEqual(50);
		expect(body.filename.startsWith(`${RESISTANT_PREFIX}-`)).toBe(true);
		// The incumbent speech at the legacy key was NOT deleted/clobbered.
		const deletedLegacy = boundStmts(env).some((s) => s.sql.startsWith('DELETE FROM speech_content') && s.args[0] === LEGACY_KEY);
		expect(deletedLegacy).toBe(false);
		// speech_index INSERT used the resistant key, not the legacy one.
		const idxInsert = boundStmts(env).find((s) => s.sql.startsWith('INSERT INTO speech_index'));
		expect(idxInsert?.args?.[0]).toBe(body.filename);
	});

	it('PATCH re-points to a collision-resistant key instead of editing a different-titled speech', async () => {
		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('section_id_counter') && sql.includes('RETURNING'))
				return { success: true, results: [{ next_id: 2001 + Number(args[0] || 1) }] };
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === LEGACY_KEY)
					return { success: true, results: [{ filename: LEGACY_KEY, display_name: 'Gardeners — thrive', alternate_filename: null }] };
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) return { success: true, results: [] };
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: RAW_B, markdown: '# Gardeners — survive\n\nthe other speech' }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { filename: string };
		expect(body.filename).not.toBe(LEGACY_KEY);
		expect(body.filename.startsWith(`${RESISTANT_PREFIX}-`)).toBe(true);
		const deletedLegacy = boundStmts(env).some((s) => s.sql.startsWith('DELETE FROM speech_content') && s.args[0] === LEGACY_KEY);
		expect(deletedLegacy).toBe(false);
		const idxInsert = env.__directStatements.find((s) => s.sql.includes('INSERT INTO speech_index'));
		expect(idxInsert?.args?.[0]).toBe(body.filename);
	});
});

// ---------------------------------------------------------------------------
// Cache purge failures (503 responses)
// ---------------------------------------------------------------------------

describe('upload_markdown cachePurge failures', () => {
	it('returns 503 when cache purge fails after PATCH', async () => {
		const purge = workersCache.purge as unknown as { mockResolvedValue: (v: unknown) => void };
		purge.mockResolvedValue({ success: false });
		const env = createMockEnv(demoSpeechResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nAlpha\n\nBeta' }),
		});
		expect(res.status).toBe(503);
		const json = (await res.json()) as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(false);
	});

	it('returns 503 when cache purge fails after DELETE', async () => {
		const purge = workersCache.purge as unknown as { mockResolvedValue: (v: unknown) => void };
		purge.mockResolvedValue({ success: false });
		const env = createMockEnv(deleteResolver({ speakerRoutes: [] }));
		const { res } = await dispatch('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(503);
		const json = (await res.json()) as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(false);
		expect(json.searchSync).toBe(false);
	});

	it('returns 503 when cache purge fails after POST', async () => {
		const purge = workersCache.purge as unknown as { mockResolvedValue: (v: unknown) => void };
		purge.mockResolvedValue({ success: false });
		const env = createMockEnv(demoSpeechResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'brand-new-speech', markdown: '# Brand New\n## Speaker:\nhello' }),
		});
		expect(res.status).toBe(503);
		const json = (await res.json()) as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(false);
		expect(json.searchSync).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// R2 origin delete failures
// ---------------------------------------------------------------------------

describe('upload_markdown R2 origin delete failures', () => {
	it('returns 503 when R2 origin delete fails after PATCH even if Workers purge succeeds', async () => {
		const env = createMockEnv(demoSpeechResolver());
		env.SPEECH_CACHE.delete = async () => {
			throw new Error('r2 delete failed');
		};
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nAlpha\n\nBeta' }),
		});
		expect(res.status).toBe(503);
		const json = (await res.json()) as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(false);
		expect(json.searchSync).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Search artifact sync failures
// ---------------------------------------------------------------------------

describe('upload_markdown search artifact sync failures', () => {
	it('returns 503 when search overlay sync fails after PATCH', async () => {
		const env = createMockEnv(demoSpeechResolver());
		const originalPut = env.SPEECH_CACHE.put.bind(env.SPEECH_CACHE);
		env.SPEECH_CACHE.put = async (key: string, body: string) => {
			if (String(key).startsWith('search-updates/') || key === 'stats.json' || key === 'search-index-manifest.json') {
				throw new Error('search r2 write failed');
			}
			return originalPut(key, body);
		};
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nAlpha\n\nBeta' }),
		});
		expect(res.status).toBe(503);
		const json = (await res.json()) as { success: boolean; cachePurge: boolean; searchSync: boolean };
		expect(json.success).toBe(true);
		expect(json.cachePurge).toBe(true);
		expect(json.searchSync).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// POST replace prefetch orphans
// ---------------------------------------------------------------------------

describe('upload_markdown POST replace prefetch', () => {
	it('POST replace prefetches prior speakers and cleans orphans', async () => {
		const env = createMockEnv(demoSpeechResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ filename: 'demo-speech', markdown: '# Demo Speech\nOnly body no speaker mark' }),
		});
		expect([200, 503]).toContain(res.status);
		const orphanDeletes = boundStmts(env).filter(
			(s) => s.sql.includes('DELETE FROM speakers WHERE route_pathname = ? AND NOT EXISTS') && s.args[0] === 'ZOMBIE',
		);
		expect(orphanDeletes.length).toBeGreaterThan(0);
	});
});
