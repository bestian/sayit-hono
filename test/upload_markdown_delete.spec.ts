import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type PreparedStatement = { sql: string; args: unknown[] };

function createDeleteEnv(options: { speakerRoutes?: string[]; redirects?: Record<string, string> } = {}) {
	const operations: PreparedStatement[] = [];
	const deletedKeys: string[] = [];
	const putObjects = new Map<string, string>();
	const speakerRoutes = options.speakerRoutes ?? ['audrey-tang', 'bestian'];
	const redirects: Record<string, string> = options.redirects ?? {};

	function query(sql: string, args: unknown[]) {
		if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
			return { success: true, results: speakerRoutes.map((r) => ({ speaker_route_pathname: r })) };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_index')) {
			return { success: true, results: [{ count: 0 }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speakers')) {
			return { success: true, results: [{ count: 0 }] };
		}
		if (sql.includes('SELECT COUNT(*) AS count FROM speech_content')) {
			return { success: true, results: [{ count: 0 }] };
		}
		if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) {
			const target = redirects[String(args[0])];
			return { success: true, results: target ? [{ new_filename: target }] : [] };
		}
		if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
			// Prefetch before DELETE; values only matter for purge key coverage.
			return { success: true, results: [{ section_id: 100 }, { section_id: 101 }] };
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
			list: async () => ({ objects: [], truncated: false, cursor: '' }),
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
				});
				return {
					bind: (...args: unknown[]) => run(args),
					first: async () => run([]).first(),
					all: async () => run([]).all(),
				};
			},
			batch: async (statements: PreparedStatement[]) => {
				for (const stmt of statements) {
					operations.push(stmt);
				}
				return statements.map(() => ({ meta: { changes: 1 } }));
			},
		},
		__operations: operations,
		__deletedKeys: deletedKeys,
		__putObjects: putObjects,
	};
}

async function request(path: string, env: ReturnType<typeof createDeleteEnv>, init?: RequestInit<IncomingRequestCfProperties>) {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env as any, ctx);
	return { res };
}

describe('DELETE /api/upload_markdown', () => {
	it('issues delete batch with content, relations, index, and orphan cleanup', async () => {
		const env = createDeleteEnv({ speakerRoutes: ['audrey-tang', 'bestian'] });

		const { res } = await request('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; deleted: Record<string, number> };
		expect(json.success).toBe(true);
		expect(json.deleted).toEqual({ sections: 1, relations: 1, speakers: 2, speech: 1 });

		// First three batch statements are the speech-scope deletes; remainder are orphan speaker deletes.
		const batchSqls = env.__operations.map((s) => s.sql.trim().split('\n')[0].trim());
		expect(batchSqls[0]).toContain('DELETE FROM speech_content');
		expect(batchSqls[1]).toContain('DELETE FROM speech_speakers');
		expect(batchSqls[2]).toContain('DELETE FROM speech_index');
		expect(env.__operations.slice(3).map((s) => s.sql)).toEqual([
			expect.stringContaining('DELETE FROM speakers'),
			expect.stringContaining('DELETE FROM speakers'),
		]);
		expect(env.__operations.slice(3).map((s) => s.args[0])).toEqual(['audrey-tang', 'bestian']);
	});

	it('invalidates speech, speaker, and list-page R2 caches', async () => {
		const env = createDeleteEnv({ speakerRoutes: ['audrey-tang'] });

		await request('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});

		expect(env.__deletedKeys).toEqual(
			expect.arrayContaining([
				`${CACHE_KEY_VERSION}/example.com/demo-speech`,
				`${CACHE_KEY_VERSION}/example.com/speaker/audrey-tang`,
				`${CACHE_KEY_VERSION}/example.com/speeches`,
				`${CACHE_KEY_VERSION}/example.com/speakers`,
				`${CACHE_KEY_VERSION}/example.com/rss.xml`,
				`${CACHE_KEY_VERSION}/example.com/`,
			]),
		);
	});

	it('returns 404 when no rows match', async () => {
		const env = createDeleteEnv({ speakerRoutes: [] });
		// Override batch to simulate no-op
		env.DB.batch = (async (statements: PreparedStatement[]) => {
			for (const stmt of statements) env.__operations.push(stmt);
			return statements.map(() => ({ meta: { changes: 0 } }));
		}) as any;

		const { res } = await request('/api/upload_markdown?filename=ghost', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});

		expect(res.status).toBe(404);
	});

	it('rewrites filename via speech_redirects to the canonical target before deleting', async () => {
		const env = createDeleteEnv({
			speakerRoutes: ['audrey-tang'],
			redirects: { 'deprecated-name': 'canonical-name' },
		});

		const { res } = await request('/api/upload_markdown?filename=deprecated-name', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});

		expect(res.status).toBe(200);
		// All DELETE statements should be against the canonical filename
		const deleteContent = env.__operations.find((s) => s.sql.startsWith('DELETE FROM speech_content'));
		expect(deleteContent!.args[0]).toBe('canonical-name');
		const deleteIndex = env.__operations.find((s) => s.sql.startsWith('DELETE FROM speech_index'));
		expect(deleteIndex!.args[0]).toBe('canonical-name');
	});

	it('returns 400 when filename query param is missing', async () => {
		const env = createDeleteEnv();
		const { res } = await request('/api/upload_markdown', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(400);
	});

	it('marks speech deleted in search manifest and deletes overlay key', async () => {
		const env = createDeleteEnv({ speakerRoutes: ['audrey-tang'] });

		await request('/api/upload_markdown?filename=demo-speech', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});

		// markSpeechDeletedInSearch writes the manifest marker and deletes the per-speech overlay.
		const manifestWrite = env.__putObjects.get('search-index-manifest.json');
		expect(manifestWrite).toBeDefined();
		expect(manifestWrite).toContain('"deleted":true');
		expect(env.__deletedKeys).toEqual(expect.arrayContaining([expect.stringMatching(/^search-updates\/demo-speech\.json$/)]));
		// syncSearchStats writes a stats snapshot.
		expect(env.__putObjects.get('stats.json')).toContain('"sections"');
	});
});
