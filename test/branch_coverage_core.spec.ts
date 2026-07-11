import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';
import { purgeMock } from './setup-cache-isolation';
import { createMockEnv, dispatch, type QueryResolver } from './helpers/mockEnv';
import { decodeHtmlEntities } from '../src/utils/textUtils';
import { sectionMatchKey } from '../src/utils/sectionPatch';
import { docsFromSections, type ApiSection } from '../src/search/docBuilder';
import { buildSearchDocsForSpeech } from '../src/search/runtime';

describe('Branch Coverage Core Gaps', () => {
	afterEach(() => {
		purgeMock.mockReset();
		purgeMock.mockResolvedValue({ success: true, errors: [] });
	});

	describe('src/utils/textUtils.ts', () => {
		it('preserves unknown HTML entities', () => {
			expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;');
			expect(decodeHtmlEntities('&amp;')).toBe('&');
		});
	});

	describe('src/utils/sectionPatch.ts', () => {
		it('handles null speaker and embedded media', () => {
			expect(sectionMatchKey({ markdown: '<iframe></iframe>', speaker: null })).toBe('\u0000__embedded_iframe__');
			expect(sectionMatchKey({ markdown: '<iframe></iframe>', speaker: 'Audrey' })).toBe('Audrey\u0000__embedded_iframe__');
		});
	});

	describe('src/search/docBuilder.ts', () => {
		it('handles falsy section content', () => {
			const emptySection: ApiSection = {
				filename: 'test-file',
				nest_filename: null,
				section_id: 1,
				section_content: null, // real D1 rows / external JSON can supply null despite the loose ApiSection contract
				display_name: '2026-03-24 Demo',
				name: null,
			};
			const docs = docsFromSections([emptySection], '/test-file');
			expect(docs).toEqual([]);
		});
	});

	describe('src/search/runtime.ts', () => {
		it('handles query result mapping branches', async () => {
			const rows = [
				{
					filename: 'test-file',
					nest_filename: null,
					section_id: 1,
					previous_section_id: null,
					next_section_id: 2,
					section_content: null,
					display_name: null,
					name: 'Speaker 1',
				},
				{
					filename: 'test-file',
					nest_filename: null,
					section_id: 2,
					previous_section_id: 1,
					next_section_id: null,
					section_content: 'Hello',
					display_name: 'Demo Speech',
					name: null,
				},
			];
			const mockCtx = {
				env: {
					DB: {
						prepare: () => ({
							bind: () => ({
								all: async <T>() => ({ success: true, results: rows as T[] }),
							}),
						}),
					},
				},
			}; // Mock context for search runtime branches

			const result = await buildSearchDocsForSpeech(mockCtx, 'test-file');
			expect(result.length).toBe(1);
			expect(result[0].content).toBe('Hello');
		});
	});

	describe('src/index.ts', () => {
		it('handles api/search.json nullable display date and nest filename', async () => {
			const searchResolver: QueryResolver = (sql, _args) => {
				if (sql.includes('SELECT id, route_pathname, name FROM speakers WHERE id = ?')) {
					return { success: true, results: [] };
				}
				if (sql.includes('SELECT COUNT(*) AS count') && sql.includes('FROM speech_content sc')) {
					return { success: true, results: [{ count: 2 }] };
				}
				if (sql.includes('FROM speech_content sc') && sql.includes('LEFT JOIN speech_index si') && sql.includes('ORDER BY')) {
					return {
						success: true,
						results: [
							{
								filename: 'test-file',
								nest_filename: null,
								display_name: null,
								section_id: 1,
								section_speaker: 'speaker-1',
								section_content: '<p>needle</p>',
								speaker_name: null,
								photoURL: null,
							},
							{
								filename: 'test-file2',
								nest_filename: 'nested-file',
								display_name: '2026-03-24 Demo',
								section_id: 2,
								section_speaker: 'speaker-2',
								section_content: '<p>needle2</p>',
								speaker_name: 'Speaker 2',
								photoURL: null,
							},
						],
					};
				}
				return { success: true, results: [] };
			};

			const env = createMockEnv(searchResolver);
			const { res } = await dispatch('/api/search.json?q=needle', env);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { results: Array<{ title: string; url: string; date: string; speaker: string }> };
			expect(body.results.length).toBe(2);
			expect(body.results[0].date).toBe('');
			expect(body.results[1].date).toBe('2026-03-24');
		});

		it('handles api/purge_cache pagination and purge failure', async () => {
			purgeMock.mockResolvedValue({ success: false, errors: [] });
			const env = createMockEnv(() => ({ success: true, results: [] }));

			let listCount = 0;
			env.SPEECH_CACHE.list = vi.fn().mockImplementation(async () => {
				listCount++;
				if (listCount === 1) {
					return {
						objects: [{ key: 'k1' }],
						truncated: true,
						cursor: 'page2',
					};
				}
				return {
					objects: [],
					truncated: false,
					cursor: '',
				};
			});

			const { res } = await dispatch('/api/purge_cache', env, {
				method: 'POST',
				headers: { Authorization: 'Bearer token-audrey' },
			});
			expect(res.status).toBe(503);
			const body = (await res.json()) as { deleted: number; purged: boolean };
			expect(body.deleted).toBe(1);
			expect(body.purged).toBe(false);
		});

		it('handles api/purge_cache empty list and purge success', async () => {
			purgeMock.mockResolvedValueOnce({ success: true, errors: [] });
			const env = createMockEnv(() => ({ success: true, results: [] }));

			env.SPEECH_CACHE.list = vi.fn().mockResolvedValueOnce({
				objects: [],
				truncated: false,
				cursor: '',
			});

			const { res } = await dispatch('/api/purge_cache', env, {
				method: 'POST',
				headers: { Authorization: 'Bearer token-audrey' },
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { deleted: number; purged: boolean };
			expect(body.deleted).toBe(0);
			expect(body.purged).toBe(true);
		});

		it('handles api/cleanup_old_cache pagination and empty deletion page', async () => {
			const env = createMockEnv(() => ({ success: true, results: [] }));

			let listCount = 0;
			env.SPEECH_CACHE.list = vi.fn().mockImplementation(async () => {
				listCount++;
				if (listCount === 1) {
					return {
						objects: [{ key: `${CACHE_KEY_VERSION}/keep-1` }],
						truncated: true,
						cursor: 'page2',
					};
				}
				return {
					objects: [{ key: 'v-old/delete-1' }],
					truncated: false,
					cursor: '',
				};
			});

			const { res } = await dispatch('/api/cleanup_old_cache', env, {
				method: 'POST',
				headers: { Authorization: 'Bearer token-audrey' },
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { deleted: number; more: boolean };
			expect(body.deleted).toBe(1);
			expect(body.more).toBe(false);
		});
	});
});
