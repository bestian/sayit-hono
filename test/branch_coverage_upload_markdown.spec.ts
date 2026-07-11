import { describe, expect, it } from 'vite-plus/test';
import { createMockEnv, dispatch } from './helpers/mockEnv';
import type { QueryResolver, PreparedStatement } from './helpers/mockEnv';

describe('upload_markdown branch coverage extra cases', () => {
	it('covers speaker normalization for 唐鳳 and non-唐鳳 speakers', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 105 }] };
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		const markdown = ['# Title', '## 唐鳳:', 'Hello', '## Audrey:', 'World'].join('\n');

		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'speaker-test', markdown }),
		});
		expect(res.status).toBe(200);

		const boundStmts = env.__batchedStatements.filter(
			(s): s is PreparedStatement => s && typeof s === 'object' && 'sql' in s && typeof s.sql === 'string',
		);
		const inserts = boundStmts.filter((s) => s.sql.includes('INSERT OR IGNORE INTO speech_speakers'));
		const routePathnames = inserts.map((s) => s.args[1]);
		expect(routePathnames).toContain('%E5%94%90%E9%B3%B3-3');
		expect(routePathnames).toContain('Audrey');
	});

	it('handles empty markdown inputs to cover buf.length=0 flush and title fallback on POST', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('SELECT filename FROM speech_index WHERE filename = ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 200 }] };
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'empty-test', markdown: ' ' }),
		});
		expect(res.status).toBe(200);

		const boundStmts = env.__batchedStatements.filter(
			(s): s is PreparedStatement => s && typeof s === 'object' && 'sql' in s && typeof s.sql === 'string',
		);
		const insertIndex = boundStmts.find((s) => s.sql.includes('INSERT INTO speech_index'));
		expect(insertIndex).toBeDefined();
		expect(insertIndex?.args[0]).toBe('empty-test');
		expect(insertIndex?.args[1]).toBe('empty-test');
	});

	it('handles non-finite section IDs on DELETE to cover isFinite check in invalidateSpeechCaches', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				return { success: true, results: [{ filename: 'nan-delete', display_name: 'NAN' }] };
			}
			if (sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return { success: true, results: [] };
			}
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
				return { success: true, results: [{ section_id: NaN }] };
			}
			if (sql.includes('FROM speech_redirects WHERE old_filename = ?')) {
				return { success: true, results: [] };
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		// Mock batch to return changes with genuine type signature
		env.DB.batch = async (statements: PreparedStatement[]) => {
			return statements.map((stmt) => {
				const sql = stmt.sql;
				if (sql.includes('DELETE FROM speech_content')) {
					return { meta: { changes: 1 } };
				}
				if (sql.includes('DELETE FROM speech_speakers')) {
					return { meta: { changes: 0 } };
				}
				if (sql.includes('DELETE FROM speech_index')) {
					return { meta: { changes: 1 } };
				}
				return { meta: { changes: 0 } };
			});
		};

		const { res } = await dispatch('/api/upload_markdown?filename=nan-delete', env, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer token-audrey' },
		});
		expect(res.status).toBe(200);
	});

	it('clears alternate_filename and falls back to filename for display name on PATCH', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				return {
					success: true,
					results: [
						{
							filename: 'patch-clear-test',
							display_name: 'Existing Speech',
							isNested: 0,
							alternate_filename: 'old-paired-speech',
						},
					],
				};
			}
			if (sql.includes('FROM speech_speakers') || sql.includes('SELECT speaker_route_pathname FROM speech_speakers')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content') && sql.includes('ORDER BY section_id ASC')) {
				return {
					success: true,
					results: [
						{
							filename: 'patch-clear-test',
							section_id: 100,
							previous_section_id: null,
							section_speaker: 'A',
							section_content: '<p>Old hello</p>',
						},
					],
				};
			}
			if (sql.includes('SELECT section_id FROM speech_content WHERE filename = ?')) {
				return { success: true, results: [{ section_id: 100 }] };
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 105 }] };
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'patch-clear-test',
				markdown: '\n## A:\nNew hello',
				alternate_filename: '  ',
			}),
		});
		expect(res.status).toBe(200);

		const boundStmts = env.__batchedStatements.filter(
			(s): s is PreparedStatement => s && typeof s === 'object' && 'sql' in s && typeof s.sql === 'string',
		);
		const updates = boundStmts.filter((s) => s.sql.includes('UPDATE speech_index'));
		const updateIndex = updates.find((s) => s.sql.includes('display_name = ?') && s.sql.includes('alternate_filename = ?'));
		expect(updateIndex).toBeDefined();
		expect(updateIndex?.args[0]).toBe('patch-clear-test');
		expect(updateIndex?.args[1]).toBeNull();
	});

	it('handles empty results arrays for oldSections and oldSpeakers query responses on PATCH', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				return {
					success: true,
					results: [
						{
							filename: 'empty-results-test',
							display_name: 'Empty Speech',
							isNested: 0,
							alternate_filename: null,
						},
					],
				};
			}
			if (sql.includes('FROM speech_speakers WHERE speech_filename = ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content WHERE filename = ?')) {
				return { success: true, results: [] };
			}
			if (sql.includes('section_id_counter') && sql.includes('RETURNING')) {
				return { success: true, results: [{ next_id: 500 }] };
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: 'empty-results-test',
				markdown: '# Empty Speech\n## A:\nHello',
			}),
		});
		expect(res.status).toBe(200);
	});
});
