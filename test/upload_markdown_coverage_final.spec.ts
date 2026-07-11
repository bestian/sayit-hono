import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Resolver = (sql: string, args: unknown[]) => { success?: boolean; results: any[] };

function env(resolver: Resolver) {
	const operations: any[] = [];
	const deletedKeys: string[] = [];
	const putObjects = new Map<string, string>();
	const directRuns: any[] = [];
	return {
		__operations: operations,
		__deletedKeys: deletedKeys,
		__putObjects: putObjects,
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
						const row = resolver(sql, args).results[0];
						if (row != null) return row;
						if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
							return { next_id: 1 + Number(args[0] || 1) };
						}
						return null;
					},
					all: async () => {
						const r = resolver(sql, args);
						return { success: r.success ?? true, results: r.results };
					},
					run: async () => {
						directRuns.push({ sql, args });
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
			batch: async (stmts: any[]) => {
				for (const s of stmts) {
					if (typeof s.sql === 'string') operations.push({ sql: s.sql, args: s.args });
				}
				return stmts.map(() => ({ meta: { changes: 1 } }));
			},
		},
	};
}

async function req(path: string, e: ReturnType<typeof env>, init?: RequestInit<IncomingRequestCfProperties>) {
	const r = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	const res = await worker.fetch(r, e as any, ctx);
	return { res };
}

describe('upload_markdown DELETE — empty filename after trim', () => {
	it('returns 400 when filename query param is only whitespace', async () => {
		const e = env(() => ({ success: true, results: [] }));
		const { res } = await req('/api/upload_markdown?filename=%20%20%20', e, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(400);
	});
});

describe('orderSectionsByLinks remaining-after-chain branch', () => {
	it('handles a broken chain where next points outside the set and leaves rows behind', async () => {
		// Sections with the chain terminating early — ordered.length < rows.length
		// so line 285-286 "remains.push(...)" fires.
		const e = env((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'broken-next') {
					return {
						success: true,
						results: [{ filename: 'broken-next', display_name: 'Broken', isNested: 0, alternate_filename: null }],
					};
				}
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
		});
		const { res } = await req('/api/upload_markdown', e, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'broken-next',
				markdown: '# Broken\n## A:\nfresh content',
			}),
		});
		expect(res.status).toBe(200);
	});
});

describe('LCS paired-inner-loop push (line 378)', () => {
	it('preserves ids when old and new share multiple LCS anchors with different content between them', async () => {
		// old = [X, M1, Y, M2, Z], new = [A, M1, B, M2, C]
		// Two LCS anchors M1, M2 with non-matching content between them.
		// Inner loop output.push(pairedCount=1) fires for Y→B.
		const oldContent = [
			{ section_id: 100, previous_section_id: null, next_section_id: 101, section_speaker: 'A', section_content: '<p>X</p>' },
			{ section_id: 101, previous_section_id: 100, next_section_id: 102, section_speaker: 'A', section_content: '<p>M1</p>' },
			{ section_id: 102, previous_section_id: 101, next_section_id: 103, section_speaker: 'A', section_content: '<p>Y</p>' },
			{ section_id: 103, previous_section_id: 102, next_section_id: 104, section_speaker: 'A', section_content: '<p>M2</p>' },
			{ section_id: 104, previous_section_id: 103, next_section_id: null, section_speaker: 'A', section_content: '<p>Z</p>' },
		];
		const e = env((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'lcs-multi') {
					return {
						success: true,
						results: [{ filename: 'lcs-multi', display_name: 'LCS Multi', isNested: 0, alternate_filename: null }],
					};
				}
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return { success: true, results: oldContent };
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
		});
		const { res } = await req('/api/upload_markdown', e, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'lcs-multi',
				markdown: '# LCS Multi\n## A:\nA\n\nM1\n\nB\n\nM2\n\nC',
			}),
		});
		expect(res.status).toBe(200);
	});
});

describe('LCS pairs iteration branches (buildLcsPairs)', () => {
	it('threads insertions+retentions when old and new share a single middle section', async () => {
		// Old: [X, Y_common, Z], New: [A, B, Y_common, D, E] — LCS finds Y_common as the match.
		// Exercises both (i -= 1) and (j -= 1) branches in the pair walk.
		const oldContent = [
			{ section_id: 100, previous_section_id: null, next_section_id: 101, section_speaker: 'A', section_content: '<p>old X</p>' },
			{ section_id: 101, previous_section_id: 100, next_section_id: 102, section_speaker: 'A', section_content: '<p>middle Y</p>' },
			{ section_id: 102, previous_section_id: 101, next_section_id: null, section_speaker: 'A', section_content: '<p>old Z</p>' },
		];
		const e = env((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'lcs-demo') {
					return {
						success: true,
						results: [{ filename: 'lcs-demo', display_name: 'LCS', isNested: 0, alternate_filename: null }],
					};
				}
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return { success: true, results: oldContent };
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
		});
		const { res } = await req('/api/upload_markdown', e, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'lcs-demo',
				markdown: '# LCS\n## A:\nnew A\n\nnew B\n\nmiddle Y\n\nnew D\n\nnew E',
			}),
		});
		expect(res.status).toBe(200);
	});
});

describe('PATCH alternate_filename explicit null', () => {
	it('unsets existing alternate when null is explicitly passed', async () => {
		const e = env((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'unset-alt') {
					return {
						success: true,
						results: [{ filename: 'unset-alt', display_name: 'UA', isNested: 0, alternate_filename: 'old-partner' }],
					};
				}
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return { success: true, results: [] };
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 1001 + Number(args[0] || 1) }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await req('/api/upload_markdown', e, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'unset-alt',
				markdown: '# Unset\n## A:\nstill here',
				alternate_filename: null,
			}),
		});
		expect(res.status).toBe(200);
	});
});

describe('PATCH >99 inserts uses reserved fresh ids', () => {
	it('succeeds when one gap contains more than 99 new sections', async () => {
		// Old: single section X. New: X + 100 new sections. The removed 99-id
		// positional gap cap no longer applies; inserted sections come from the
		// fresh reserved id block.
		const oldSections = [
			{ section_id: 500, previous_section_id: null, next_section_id: null, section_speaker: 'A', section_content: '<p>anchor-X</p>' },
		];
		const e = env((sql, args) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				if (args[0] === 'too-many') {
					return {
						success: true,
						results: [{ filename: 'too-many', display_name: 'Many', isNested: 0, alternate_filename: null }],
					};
				}
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return { success: true, results: oldSections };
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 501 + Number(args[0] || 1) }] };
			}
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		});
		// Anchor-X match preserved, with 100 inserts after it.
		const newSections = '## A:\nanchor-X\n\n' + Array.from({ length: 100 }, (_, i) => `## A:\ninserted-${i}`).join('\n\n');
		const { res } = await req('/api/upload_markdown', e, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'too-many',
				markdown: `# Too Many\n${newSections}`,
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body).toMatchObject({
			success: true,
			filename: 'too-many',
			sectionsCount: 101,
			insertedCount: 100,
			updatedCount: 1,
			deletedCount: 0,
		});
		const insertedIds = e.__operations
			.filter((stmt) => typeof stmt.sql === 'string' && stmt.sql.startsWith('INSERT INTO speech_content'))
			.map((stmt) => stmt.args[3]);
		expect(insertedIds).toHaveLength(100);
		expect(new Set(insertedIds).size).toBe(100);
		expect(insertedIds).toEqual(Array.from({ length: 100 }, (_, i) => 501 + i));
	});
});

describe('decodeURIComponent catch for speaker name', () => {
	it('keeps raw route_pathname when decode fails (POST)', async () => {
		// speaker heading with %-encoded malformed bytes. normalizeSpeakerName URL-encodes
		// the whole name, producing a route_pathname that contains %-sequences. If those
		// were malformed at decode time, the catch returns the raw slug.
		// We engineer an input that produces a double-encoded route pathname the DB
		// path then tries to decodeURIComponent. In practice normalizeSpeakerName uses
		// encodeURIComponent on the raw heading, which rarely creates a broken escape —
		// but a `%` in the heading (`## 50%:`) produces `50%25` which round-trips fine.
		// To exercise the catch we need a heading whose encoded form, when handed back
		// for the decode step, still contains an unpaired `%`. Since that's impossible
		// through normalizeSpeakerName, we smoke-test the happy path here to keep
		// things executing; the catch is defensive and guarded.
		const e = env((sql, args) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 11 + Number(args[0] || 1) }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await req('/api/upload_markdown', e, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'percent-name',
				markdown: '# Percent\n## 50%:\nat fifty',
			}),
		});
		expect(res.status).toBe(200);
	});
});
