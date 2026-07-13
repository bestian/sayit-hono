import { describe, expect, it } from 'vite-plus/test';
import { Hono } from 'hono';
import { createMockEnv, type QueryResolver } from './helpers/mockEnv';
import type { WorkerEnv } from '../src/ssr/pages/shared';
import { buildR2HtmlKey } from '../src/api/cache';

// Import handlers & logic
import { renderHomePage, renderSpeechesPage, renderSpeakersPage, renderPrivacyPage, renderTermsPage } from '../src/ssr/pages/home';
import { renderSearchPage, runSearchQuery, normalizeSearchQuery, SEARCH_DEFAULT_PAGE_SIZE } from '../src/ssr/pages/search';
import { renderSpeakerPage } from '../src/ssr/pages/speaker';
import { renderSectionPage, renderNestedSpeechPage, renderSpeechPage } from '../src/ssr/pages/speech';

// Setup test app
const testApp = new Hono<{ Bindings: WorkerEnv }>();

// Search routes
testApp.get('/search/', (c) => renderSearchPage(c));
testApp.get('/test-run-search-query', async (c) => {
	const query = c.req.query('q') ?? '';
	const page = c.req.query('page') ? Number(c.req.query('page')) : undefined;
	const pageSize = c.req.query('pageSize') ? Number(c.req.query('pageSize')) : undefined;
	const speakerId = c.req.query('speakerId') ? Number(c.req.query('speakerId')) : undefined;
	const result = await runSearchQuery(c, { query, page, pageSize, speakerId });
	return c.json(result);
});

// Home & info routes
testApp.get('/', (c) => renderHomePage(c));
testApp.get('/privacy', (c) => renderPrivacyPage(c));
testApp.get('/terms', (c) => renderTermsPage(c));
testApp.get('/speeches/', (c) => renderSpeechesPage(c));
testApp.get('/speakers/', (c) => renderSpeakersPage(c));

// Speaker routes
testApp.get('/speaker/:route_pathname', (c) => renderSpeakerPage(c));

// Speech routes
testApp.get('/speech/:section_id', (c) => renderSectionPage(c));
testApp.get('/:filename/:nest_filename', (c) => renderNestedSpeechPage(c));
testApp.get('/:filename', (c) => renderSpeechPage(c));

describe('1. Search Page Branches (search.ts)', () => {
	it('normalizeSearchQuery handles various input shapes', () => {
		expect(normalizeSearchQuery(null)).toBe('');
		expect(normalizeSearchQuery(undefined)).toBe('');
		expect(normalizeSearchQuery('   hello   ')).toBe('hello');
		expect(normalizeSearchQuery('a'.repeat(100))).toBe('a'.repeat(80));
	});

	it('runSearchQuery handles short queries early-exit', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const req = new Request('https://example.com/test-run-search-query?q=a');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { query: string; sections: unknown[] };
		expect(data.query).toBe('a');
		expect(data.sections.length).toBe(0);
	});

	it('runSearchQuery handles page & pageSize clamps and fallback', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('SELECT COUNT(*) AS count')) {
				return { success: true, results: [{ count: 120 }] };
			}
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							nest_filename: null,
							section_id: 1,
							section_speaker: 'audrey',
							section_content: 'This is a long search query match testing snippets',
							display_name: 'Speech 1',
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/test-run-search-query?q=query&page=-5&pageSize=999');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { page: number; page_size: number };
		expect(data.page).toBe(1);
		expect(data.page_size).toBe(50); // clamped to max 50
	});

	it('runSearchQuery handles invalid speakerId and speakerRow null fields', async () => {
		const resolver: QueryResolver = (sql, args) => {
			if (sql.includes('SELECT id, route_pathname, name FROM speakers WHERE id = ?')) {
				if (args[0] === 42) {
					return {
						success: true,
						results: [
							{
								id: 42,
								route_pathname: 'audrey',
								name: null, // name is null
							},
						],
					};
				}
				return { success: true, results: [] }; // speaker not found
			}
			if (sql.includes('SELECT COUNT(*) AS count')) {
				return { success: true, results: [{ count: 1 }] };
			}
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							nest_filename: null,
							section_id: 1,
							section_speaker: 'audrey',
							section_content: null, // null content
							display_name: 'Speech 1',
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		};

		// 1. Invalid speakerId (not found)
		{
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/test-run-search-query?q=query&speakerId=999');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { filteredSpeakerId?: number };
			expect(data.filteredSpeakerId).toBeUndefined();
		}

		// 2. Valid speakerId with null name
		{
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/test-run-search-query?q=query&speakerId=42');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { filteredSpeakerId?: number; filteredSpeakerName?: string | null };
			expect(data.filteredSpeakerId).toBe(42);
			expect(data.filteredSpeakerName).toBeNull();
		}
	});

	it('runSearchQuery handles speaker result failure', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speakers')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/search/?q=query');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(500);
	});

	it('runSearchQuery handles section result failure', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('SELECT COUNT(*) AS count')) {
				return { success: true, results: [{ count: 10 }] };
			}
			if (sql.includes('FROM speech_content sc')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/search/?q=query');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(500);
	});

	it('runSearchQuery falls back to defaults for explicit zero page/pageSize and missing count/section_speaker', async () => {
		const resolver: QueryResolver = (sql) => {
			// Empty count row exercises the `totalSectionsRow?.count ?? 0` fallback.
			if (sql.includes('SELECT COUNT(*) AS count')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							nest_filename: null,
							section_id: 1,
							// section_speaker intentionally omitted to exercise `row.section_speaker ?? null`
							section_content: 'Some content matching the query text here',
							display_name: 'Speech 1',
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/test-run-search-query?q=query&page=0&pageSize=0');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as {
			page: number;
			page_size: number;
			total_sections: number;
			sections: Array<{ section_speaker: string | null }>;
		};
		expect(data.page).toBe(1);
		expect(data.page_size).toBe(SEARCH_DEFAULT_PAGE_SIZE);
		expect(data.total_sections).toBe(0);
		expect(data.sections[0]?.section_speaker).toBeNull();
	});

	it('renderSearchPage falls back to page 1 on a non-positive page and parses a positive speaker filter param', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const req = new Request('https://example.com/search/?q=query&page=0&p=5');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
	});

	it('runSearchQuery snippet trimming covers no-match truncation and mid-text ellipses', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							filename: 'no-match-short',
							nest_filename: null,
							section_id: 1,
							section_speaker: null,
							// Short content that never contains the query -> matchIndex < 0, no truncation needed.
							section_content: 'Completely unrelated short text.',
							display_name: 'No Match Short',
							speaker_name: null,
							photoURL: null,
						},
						{
							filename: 'no-match-long',
							nest_filename: null,
							section_id: 2,
							section_speaker: null,
							// Long content (> 160 chars) that never contains the query -> matchIndex < 0, truncated with '...'.
							section_content: `Unrelated padding text that never mentions the search phrase at all. ${'Filler words go here. '.repeat(6)}`,
							display_name: 'No Match Long',
							speaker_name: null,
							photoURL: null,
						},
						{
							filename: 'mid-text-match',
							nest_filename: null,
							section_id: 3,
							section_speaker: null,
							// Match far enough into a long text to trigger both the leading and trailing ellipsis.
							section_content: `${'A'.repeat(60)} searchterm ${'B'.repeat(200)}`,
							display_name: 'Mid Text Match',
							speaker_name: null,
							photoURL: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		};

		// No-match cases: query never appears in the content.
		const envNoMatch = createMockEnv(resolver);
		const reqNoMatch = new Request('https://example.com/test-run-search-query?q=missingterm');
		const resNoMatch = await testApp.fetch(reqNoMatch, envNoMatch);
		expect(resNoMatch.status).toBe(200);
		const dataNoMatch = (await resNoMatch.json()) as { sections: Array<{ snippet: string }> };
		expect(dataNoMatch.sections[0].snippet).toBe('Completely unrelated short text.');
		expect(dataNoMatch.sections[1].snippet.endsWith('...')).toBe(true);

		// Mid-text match: leading and trailing ellipses both applied.
		const envMatch = createMockEnv(resolver);
		const reqMatch = new Request('https://example.com/test-run-search-query?q=searchterm');
		const resMatch = await testApp.fetch(reqMatch, envMatch);
		expect(resMatch.status).toBe(200);
		const dataMatch = (await resMatch.json()) as { sections: Array<{ snippet: string }> };
		expect(dataMatch.sections[2].snippet.startsWith('...')).toBe(true);
		expect(dataMatch.sections[2].snippet.endsWith('...')).toBe(true);
	});

	it('runSearchQuery includes matching speakers in results when not filtered by speakerId', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('ORDER BY instr(lower(COALESCE(name')) {
				return {
					success: true,
					results: [{ id: 7, route_pathname: 'audrey', name: 'Audrey Tang', photoURL: 'https://example.com/a.png' }],
				};
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/test-run-search-query?q=audrey');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { speakers: Array<{ route_pathname: string; name: string; photoURL: string | null }> };
		expect(data.speakers).toEqual([
			{ route_pathname: 'audrey', name: 'Audrey Tang', photoURL: 'https://example.com/a.png', snippet: expect.any(String) },
		]);
	});
});

describe('2. Speaker Page Branches (speaker.ts)', () => {
	it('renderSpeakerPage handles missing speaker row', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const req = new Request('https://example.com/speaker/nonexistent');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(404);
	});

	it('renderSpeakerPage serves an R2-cached response without hitting the DB', async () => {
		const cacheKey = buildR2HtmlKey('https://example.com/speaker/audrey');
		const env = createMockEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { [cacheKey]: { body: 'cached speaker page', customMetadata: { cacheTag: 'speaker:audrey' } } },
		});
		const req = new Request('https://example.com/speaker/audrey');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('cached speaker page');
		expect(res.headers.get('Cache-Tag')).toBe('speaker:audrey');
	});

	it('renderSpeakerPage handles invalid page params and fallbacks', async () => {
		const resolver: QueryResolver = (sql, _args) => {
			if (sql.includes('FROM speakers WHERE route_pathname = ?')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							route_pathname: 'audrey',
							name: 'Audrey',
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('WHERE name = ? AND photoURL IS NOT NULL')) {
				return { success: true, results: [] };
			}
			if (sql.includes('COUNT(DISTINCT speech_filename)')) {
				return { success: true, results: [{ count: null }] };
			}
			if (sql.includes('COUNT(*) AS count FROM speech_content')) {
				return { success: true, results: [{ count: null }] };
			}
			if (sql.includes('ORDER BY LENGTH(sc.section_content)')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'audrey',
							section_content: 'Hello, testing twitter-tweet here',
							display_name: 'Speech 1',
						},
					],
				};
			}
			return { success: true, results: [] };
		};

		// 1. Page param is invalid (non-numeric)
		{
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speaker/audrey?page=invalid');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).toContain('Audrey');
		}

		// 2. Page param is < 1
		{
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speaker/audrey?page=0');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
		}

		// 3. Page param is valid (>= 1)
		{
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speaker/audrey?page=2');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
		}
	});

	it('renderSpeakerPage handles longest section values and Twitter scripts', async () => {
		const resolver: QueryResolver = (sql, _args) => {
			if (sql.includes('FROM speakers WHERE route_pathname = ?')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							route_pathname: 'audrey',
							name: 'Audrey',
							photoURL: 'https://example.com/photo.png',
						},
					],
				};
			}
			if (sql.includes('COUNT(DISTINCT speech_filename)')) {
				return { success: true, results: [{ count: 10 }] };
			}
			if (sql.includes('COUNT(*) AS count FROM speech_content')) {
				return { success: true, results: [{ count: 5 }] };
			}
			if (sql.includes('ORDER BY LENGTH(sc.section_content)')) {
				return {
					success: true,
					results: [
						{
							section_id: 99,
							section_content: null, // test fallback to ''
							filename: null, // test fallback to ''
							nest_filename: null,
							nest_display_name: null,
							display_name: null, // test fallback to ''
						},
					],
				};
			}
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'audrey',
							section_content: 'Hello, this is a twitter-tweet embed text!',
							display_name: 'Speech 1',
						},
					],
				};
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/speaker/audrey');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain('widgets.js'); // Twitter widgets script present
	});

	it('renderSpeakerPage omits the Twitter widgets script when no embed is present', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speakers WHERE route_pathname = ?')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							route_pathname: 'audrey',
							name: 'Audrey',
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('WHERE name = ? AND photoURL IS NOT NULL')) {
				return { success: true, results: [] };
			}
			if (sql.includes('COUNT(DISTINCT speech_filename)')) {
				return { success: true, results: [{ count: 1 }] };
			}
			if (sql.includes('COUNT(*) AS count FROM speech_content')) {
				return { success: true, results: [{ count: 1 }] };
			}
			if (sql.includes('ORDER BY LENGTH(sc.section_content)')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'audrey',
							section_content: 'Plain content with no embed.',
							display_name: 'Speech 1',
						},
					],
				};
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/speaker/audrey');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toContain('widgets.js');
	});

	it('renderSpeakerPage handles DB failures on sections query', async () => {
		const resolver: QueryResolver = (sql, _args) => {
			if (sql.includes('FROM speakers WHERE route_pathname = ?')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							route_pathname: 'audrey',
							name: 'Audrey',
							photoURL: null,
						},
					],
				};
			}
			if (sql.includes('WHERE name = ? AND photoURL IS NOT NULL')) {
				return { success: true, results: [] };
			}
			if (sql.includes('COUNT(DISTINCT speech_filename)')) {
				return { success: true, results: [{ count: 5 }] };
			}
			if (sql.includes('COUNT(*) AS count FROM speech_content')) {
				return { success: true, results: [{ count: 2 }] };
			}
			if (sql.includes('ORDER BY LENGTH(sc.section_content)')) {
				return { success: true, results: [] };
			}
			if (sql.includes('FROM speech_content sc')) {
				return { success: false, results: [] };
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/speaker/audrey');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(500);
	});
});

describe('3. Speech Page Branches (speech.ts)', () => {
	it('renderSectionPage handles md, an, non-integer, R2 cached tag logic, DB errors, Twitter script', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							nest_filename: null,
							nest_display_name: null,
							section_id: 101,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'audrey',
							section_content: 'Some content here with twitter-tweet embed details.',
							display_name: 'Speech 1',
							photoURL: null,
							name: 'Audrey Tang',
						},
					],
				};
			}
			return { success: true, results: [] };
		};

		// 1. Ends with .md
		{
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speech/abc.md');
			const res = await testApp.fetch(req, env);
			// md route fetches R2 or returns 404/Redirect
			expect(res.status).toBe(404);
		}

		// 2. Ends with .an
		{
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speech/abc.an');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(404);
		}

		// 3. Non-integer section ID
		{
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speech/1.5');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(400);
		}

		// 4. R2 cached hit with and without Cache-Tag
		{
			const cacheKey = buildR2HtmlKey('https://example.com/speech/101', { includeSearch: false });
			// With tag
			const envWithTag = createMockEnv(resolver, {
				preSeedR2: {
					[cacheKey]: {
						body: 'cached page content',
						customMetadata: { cacheTag: 'tag-1,tag-2' },
					},
				},
			});
			const res1 = await testApp.fetch(new Request('https://example.com/speech/101'), envWithTag);
			expect(res1.status).toBe(200);
			expect(res1.headers.get('Cache-Tag')).toBe('tag-1,tag-2');

			// Without tag
			const envNoTag = createMockEnv(resolver, {
				preSeedR2: {
					[cacheKey]: {
						body: 'cached page content',
						customMetadata: {},
					},
				},
			});
			const res2 = await testApp.fetch(new Request('https://example.com/speech/101'), envNoTag);
			expect(res2.status).toBe(200);
			expect(res2.headers.get('Cache-Tag')).toBeNull();
		}

		// 5. DB query error / throwing
		{
			const env = createMockEnv(() => {
				throw new Error('Database query failed');
			});
			const res = await testApp.fetch(new Request('https://example.com/speech/101'), env);
			expect(res.status).toBe(500);
		}

		// 6. Section not found
		{
			const env = createMockEnv(() => ({ success: true, results: [] }));
			const res = await testApp.fetch(new Request('https://example.com/speech/999'), env);
			expect(res.status).toBe(404);
		}

		// 7. Render view with twitter script & long snippets
		{
			const env = createMockEnv(resolver);
			const res = await testApp.fetch(new Request('https://example.com/speech/101'), env);
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).toContain('widgets.js');
		}

		// 8. Null content and empty display_name fall back to the default "View Section" title
		{
			const resolverEmpty: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) {
					return {
						success: true,
						results: [
							{
								filename: 'speech-2',
								nest_filename: null,
								nest_display_name: null,
								section_id: 202,
								previous_section_id: null,
								next_section_id: null,
								section_speaker: null,
								section_content: null,
								display_name: '',
								photoURL: null,
								name: null,
							},
						],
					};
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolverEmpty);
			const res = await testApp.fetch(new Request('https://example.com/speech/202'), env);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('View Section :: SayIt');
		}

		// 8b. Null content and null (not just empty) display_name also fall back to "View Section"
		{
			const resolverNullTitle: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) {
					return {
						success: true,
						results: [
							{
								filename: 'speech-2b',
								nest_filename: null,
								nest_display_name: null,
								section_id: 204,
								previous_section_id: null,
								next_section_id: null,
								section_speaker: null,
								section_content: null,
								display_name: null,
								photoURL: null,
								name: null,
							},
						],
					};
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolverNullTitle);
			const res = await testApp.fetch(new Request('https://example.com/speech/204'), env);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('View Section :: SayIt');
		}

		// 9. Plain text over 80 chars truncates the title snippet with an ellipsis
		{
			const longContent = 'Word '.repeat(30);
			const resolverLong: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) {
					return {
						success: true,
						results: [
							{
								filename: 'speech-3',
								nest_filename: null,
								nest_display_name: null,
								section_id: 303,
								previous_section_id: null,
								next_section_id: null,
								section_speaker: null,
								section_content: longContent,
								display_name: 'Speech 3',
								photoURL: null,
								name: null,
							},
						],
					};
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolverLong);
			const res = await testApp.fetch(new Request('https://example.com/speech/303'), env);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('...” :: SayIt');
		}
	});

	it('renderSpeechPage returns 404 when a redirect row has no usable new_filename', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_redirects')) {
				return { success: true, results: [{ new_filename: '' }] };
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/unknown-speech');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(404);
	});

	it('renderNestedSpeechPage and renderSpeechPage early exit / 404 guards', async () => {
		// 1. Excluded path
		{
			const env = createMockEnv(() => ({ success: true, results: [] }));
			const req = new Request('https://example.com/api/nest');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(404);
		}

		// 2. decodeURIComponent throws in nested speech
		{
			const env = createMockEnv(() => ({ success: true, results: [] }));
			const req = new Request('https://example.com/%E0%A4%A/nest');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(404);
		}

		// 3. decodeURIComponent throws in single speech
		{
			const env = createMockEnv(() => ({ success: true, results: [] }));
			const req = new Request('https://example.com/%E0%A4%A');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(404);
		}

		// 4. Pure digits filename in speech route (left to section page)
		{
			const env = createMockEnv(() => ({ success: true, results: [] }));
			const req = new Request('https://example.com/12345');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(404);
		}
	});

	it('renderNestedSpeechPage DB errors, redirect, non-nested, no sections, alternate CJK/EN labels', async () => {
		// 1. DB error on loadSpeechMeta
		{
			const env = createMockEnv(() => {
				throw new Error('Database query failed');
			});
			const req = new Request('https://example.com/speech-filename/nest-filename');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(500);
		}

		// 2. Redirect targets check (redirect found vs null)
		{
			const resolver: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_redirects')) {
					return { success: true, results: [{ new_filename: 'new-speech' }] };
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/old-speech/nest-filename');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(301);
			expect(res.headers.get('Location')).toBe('/new-speech/nest-filename');
		}

		// 3. Redirect query throws
		{
			const resolver: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_redirects')) {
					throw new Error('Redirect table fails');
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/old-speech/nest-filename');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(404);
		}

		// 4. Not nested speechMeta
		{
			const resolver: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_index')) {
					return {
						success: true,
						results: [
							{
								filename: 'speech-1',
								display_name: 'Speech 1',
								isNested: 0, // not nested!
							},
						],
					};
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speech-1/nest-filename');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(404);
		}

		// 5. DB query nested sections fails
		{
			const resolver: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_index')) {
					return {
						success: true,
						results: [
							{
								filename: 'speech-1',
								display_name: 'Speech 1',
								isNested: 1,
							},
						],
					};
				}
				if (sql.includes('FROM speech_content sc') && sql.includes('nest_filename = ?')) {
					return { success: false, results: [] };
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speech-1/nest-filename');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(500);
		}

		// 6. Nested sections length is 0
		{
			const resolver: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_index')) {
					return {
						success: true,
						results: [
							{
								filename: 'speech-1',
								display_name: 'Speech 1',
								isNested: 1,
							},
						],
					};
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speech-1/nest-filename');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(404);
		}

		// 7. Alternate info: CJK vs English labels
		{
			const resolver = (isCjk: boolean): QueryResolver => {
				return (sql) => {
					if (sql.includes('FROM speech_index')) {
						if (sql.includes('alternate_filename')) {
							return {
								success: true,
								results: [
									{
										alternate_filename: 'speech-alt',
										alternate_display_name: isCjk ? '中文演講' : 'English Speech',
									},
								],
							};
						}
						return {
							success: true,
							results: [
								{
									filename: 'speech-1',
									display_name: null, // testing null display name
									isNested: 1,
									nest_filenames: 'nest-1,nest-2',
									nest_display_names: 'Nest 1', // less names than files, testing fallback
								},
							],
						};
					}
					if (sql.includes('FROM speech_content sc')) {
						return {
							success: true,
							results: [
								{
									filename: 'speech-1',
									nest_filename: 'nest-1',
									nest_display_name: null, // testing null nest display name
									section_id: 1,
									previous_section_id: null,
									next_section_id: null,
									section_speaker: 'audrey',
									section_content: 'Some tweet here.',
									display_name: 'Speech 1',
									photoURL: null,
									name: null,
								},
							],
						};
					}
					return { success: true, results: [] };
				};
			};

			// CJK label
			const envCjk = createMockEnv(resolver(true));
			const resCjk = await testApp.fetch(new Request('https://example.com/speech-1/nest-1'), envCjk);
			expect(resCjk.status).toBe(200);
			const htmlCjk = await resCjk.text();
			expect(htmlCjk).toContain('華文');

			// English label
			const envEn = createMockEnv(resolver(false));
			const resEn = await testApp.fetch(new Request('https://example.com/speech-1/nest-1'), envEn);
			expect(resEn.status).toBe(200);
			const htmlEn = await resEn.text();
			expect(htmlEn).toContain('English');
		}
	});

	it('renderNestedSpeechPage alternate info falls back to alternate_filename when display name is missing', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index')) {
				if (sql.includes('alternate_filename')) {
					return { success: true, results: [{ alternate_filename: '中文備用檔名', alternate_display_name: null }] };
				}
				return { success: true, results: [{ filename: 'speech-1', display_name: 'Speech 1', isNested: 1 }] };
			}
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							nest_filename: 'nest-1',
							nest_display_name: 'Nest 1',
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'audrey',
							section_content: 'Plain content, no embed.',
							display_name: 'Speech 1',
							photoURL: null,
							name: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/speech-1/nest-1');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('hreflang="zh-Hant"');
	});

	it('renderNestedSpeechPage handles null nest fields, no alternate row, no siblings, and a Twitter embed', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index')) {
				if (sql.includes('alternate_filename')) {
					return { success: true, results: [] }; // no alternate row -> loadAlternateInfo returns null
				}
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							display_name: 'Speech 1',
							isNested: 1,
							nest_filenames: null, // no siblings
							nest_display_names: null,
						},
					],
				};
			}
			if (sql.includes('FROM speech_content sc') && sql.includes('nest_filename = ?')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-1',
							nest_filename: null, // exercises `row.nest_filename ?? null`
							nest_display_name: null, // exercises the chained `?? ... ?? null` fallback
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'audrey',
							section_content: 'Contains a twitter-tweet embed here.',
							display_name: 'Speech 1',
							photoURL: null,
							name: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/speech-1/nest-1');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('widgets.js');
		expect(html).not.toContain('data-prev-btn');
	});

	it('renderSpeechPage redirects, nested list aggregation, preview failures, and single speech paths', async () => {
		// 1. Redirect check
		{
			const resolver: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_redirects')) {
					return { success: true, results: [{ new_filename: 'new-speech-single' }] };
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/old-speech-single');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(301);
			expect(res.headers.get('Location')).toBe('/new-speech-single');
		}

		// 2. Nested speech list paths, aggregation query failures, preview success/failures
		{
			const resolver = (aggSuccess: boolean, previewSuccess: boolean): QueryResolver => {
				return (sql) => {
					if (sql.includes('FROM speech_index')) {
						return {
							success: true,
							results: [
								{
									filename: 'speech-nested',
									display_name: null,
									isNested: 1,
								},
							],
						};
					}
					if (sql.includes('COUNT(*) AS section_count')) {
						if (!aggSuccess) return { success: false, results: [] };
						return {
							success: true,
							results: [
								{
									nest_filename: 'nest-1',
									nest_display_name: null, // test fallback
									section_count: 5,
									first_section_id: 101,
								},
							],
						};
					}
					if (sql.includes('SELECT section_id, section_content FROM speech_content')) {
						if (!previewSuccess) return { success: false, results: [] };
						return {
							success: true,
							results: [
								{
									section_id: 101,
									section_content: null, // test null content
								},
							],
						};
					}
					return { success: true, results: [] };
				};
			};

			// Aggregation query fails
			const envAggFail = createMockEnv(resolver(false, true));
			const resAggFail = await testApp.fetch(new Request('https://example.com/speech-nested'), envAggFail);
			expect(resAggFail.status).toBe(500);

			// Aggregation empty
			const envAggEmpty = createMockEnv((sql) => {
				if (sql.includes('FROM speech_index')) return { success: true, results: [{ filename: 'speech-nested', isNested: 1 }] };
				return { success: true, results: [] };
			});
			const resAggEmpty = await testApp.fetch(new Request('https://example.com/speech-nested'), envAggEmpty);
			expect(resAggEmpty.status).toBe(404);

			// Preview query fails & null content
			const envPreview = createMockEnv(resolver(true, false));
			const resPreview = await testApp.fetch(new Request('https://example.com/speech-nested'), envPreview);
			expect(resPreview.status).toBe(200);

			// Preview query succeeds but the first section's content is null: parseContent('')
			// yields empty plain text, so the preview map entry is skipped (no crash) rather
			// than set — success (no 500) is the only externally observable signal, matching
			// the "nested list builds a truncated preview" test below for the opposite case.
			const envPreviewEmpty = createMockEnv(resolver(true, true));
			const resPreviewEmpty = await testApp.fetch(new Request('https://example.com/speech-nested'), envPreviewEmpty);
			expect(resPreviewEmpty.status).toBe(200);
		}

		// 3. Single speech (isNested = 0) database error / empty result / default title path
		{
			const resolver = (dbFails: boolean, emptySections: boolean): QueryResolver => {
				return (sql) => {
					if (sql.includes('FROM speech_index')) {
						return {
							success: true,
							results: [
								{
									filename: 'speech-single',
									display_name: null, // test fallback to filename
									isNested: 0,
								},
							],
						};
					}
					if (sql.includes('FROM speech_content sc') && !sql.includes('speech_index')) {
						if (dbFails) return { success: false, results: [] };
						if (emptySections) return { success: true, results: [] };
						return {
							success: true,
							results: [
								{
									filename: 'speech-single',
									section_id: 1,
									previous_section_id: null,
									next_section_id: null,
									section_speaker: null,
									section_content: 'Some single speech content.',
									photoURL: null,
									name: null,
								},
							],
						};
					}
					return { success: true, results: [] };
				};
			};

			// DB query fails
			const envDbFail = createMockEnv(resolver(true, false));
			const resDbFail = await testApp.fetch(new Request('https://example.com/speech-single'), envDbFail);
			expect(resDbFail.status).toBe(500);

			// Empty sections
			const envEmptySec = createMockEnv(resolver(false, true));
			const resEmptySec = await testApp.fetch(new Request('https://example.com/speech-single'), envEmptySec);
			expect(resEmptySec.status).toBe(404);

			// Success single speech
			const envSuccess = createMockEnv(resolver(false, false));
			const resSuccess = await testApp.fetch(new Request('https://example.com/speech-single'), envSuccess);
			expect(resSuccess.status).toBe(200);
		}
	});

	it('renderSpeechPage single-speech view includes the Twitter widgets script when an embed is present', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index')) {
				return { success: true, results: [{ filename: 'speech-tweet', display_name: 'Speech Tweet', isNested: 0 }] };
			}
			if (sql.includes('FROM speech_content sc') && !sql.includes('speech_index')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-tweet',
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: null,
							section_content: 'Contains a twitter-tweet embed here.',
							photoURL: null,
							name: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/speech-tweet');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('widgets.js');
	});

	it('renderSpeechPage returns 404 for its own excluded-path check', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const req = new Request('https://example.com/api');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(404);
	});

	it('renderSpeechPage returns 500 when loadSpeechMeta throws', async () => {
		const env = createMockEnv(() => {
			throw new Error('Database query failed');
		});
		const req = new Request('https://example.com/speech-meta-db-error');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(500);
	});

	it('renderNestedSpeechPage and renderSpeechPage serve R2-cached responses without hitting the DB', async () => {
		// renderNestedSpeechPage
		{
			const cacheKey = buildR2HtmlKey('https://example.com/speech-1/nest-1', { includeSearch: false });
			const env = createMockEnv(() => ({ success: true, results: [] }), {
				preSeedR2: { [cacheKey]: { body: 'cached nested speech page' } },
			});
			const req = new Request('https://example.com/speech-1/nest-1');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('cached nested speech page');
		}

		// renderSpeechPage
		{
			const cacheKey = buildR2HtmlKey('https://example.com/speech-cached', { includeSearch: false });
			const env = createMockEnv(() => ({ success: true, results: [] }), {
				preSeedR2: { [cacheKey]: { body: 'cached single speech page' } },
			});
			const req = new Request('https://example.com/speech-cached');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('cached single speech page');
		}
	});

	it('loadAlternateInfo recovers to null when the alternate-lookup query throws', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index')) {
				if (sql.includes('alternate_filename')) {
					throw new Error('Alternate lookup fails');
				}
				return { success: true, results: [{ filename: 'speech-alt-fail', display_name: 'Speech Alt Fail', isNested: 0 }] };
			}
			if (sql.includes('FROM speech_content sc') && !sql.includes('speech_index')) {
				return {
					success: true,
					results: [
						{
							filename: 'speech-alt-fail',
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: null,
							section_content: 'Plain content.',
							photoURL: null,
							name: null,
						},
					],
				};
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/speech-alt-fail');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
	});

	it('renderSpeechPage attaches an alternate-language link for both nested-list and single-speech views', async () => {
		// Nested list view (isNested: 1)
		{
			const resolver: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_index')) {
					if (sql.includes('alternate_filename')) {
						return { success: true, results: [{ alternate_filename: 'alt-nested-en', alternate_display_name: 'English' }] };
					}
					return { success: true, results: [{ filename: 'speech-nested-alt', display_name: 'Speech Nested Alt', isNested: 1 }] };
				}
				if (sql.includes('COUNT(*) AS section_count')) {
					return {
						success: true,
						results: [{ nest_filename: 'nest-1', nest_display_name: 'Nest 1', section_count: 1, first_section_id: 601 }],
					};
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speech-nested-alt');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('hreflang="en"');
		}

		// Single-speech view (isNested: 0)
		{
			const resolver: QueryResolver = (sql) => {
				if (sql.includes('FROM speech_index')) {
					if (sql.includes('alternate_filename')) {
						return { success: true, results: [{ alternate_filename: 'alt-single-en', alternate_display_name: 'English' }] };
					}
					return { success: true, results: [{ filename: 'speech-single-alt', display_name: 'Speech Single Alt', isNested: 0 }] };
				}
				if (sql.includes('FROM speech_content sc') && !sql.includes('speech_index')) {
					return {
						success: true,
						results: [
							{
								filename: 'speech-single-alt',
								section_id: 1,
								previous_section_id: null,
								next_section_id: null,
								section_speaker: null,
								section_content: 'Plain content.',
								photoURL: null,
								name: null,
							},
						],
					};
				}
				return { success: true, results: [] };
			};
			const env = createMockEnv(resolver);
			const req = new Request('https://example.com/speech-single-alt');
			const res = await testApp.fetch(req, env);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('hreflang="en"');
		}
	});

	it('renderSpeechPage nested list builds a truncated preview from the first section of a nest', async () => {
		const longContent =
			'This is a preview sentence that is intentionally quite long so it exceeds the eighty character radius threshold for truncation.';
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index')) {
				return { success: true, results: [{ filename: 'speech-preview', display_name: 'Speech Preview', isNested: 1 }] };
			}
			if (sql.includes('COUNT(*) AS section_count')) {
				return {
					success: true,
					results: [{ nest_filename: 'nest-1', nest_display_name: 'Nest 1', section_count: 1, first_section_id: 701 }],
				};
			}
			if (sql.includes('SELECT section_id, section_content FROM speech_content')) {
				return { success: true, results: [{ section_id: 701, section_content: longContent }] };
			}
			return { success: true, results: [] };
		};
		const env = createMockEnv(resolver);
		const req = new Request('https://example.com/speech-preview');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
		// NestedSpeechView doesn't render `preview` in its template, so success (no 500 from a
		// crash in the preview-building loop) is the only externally observable signal here.
	});
});

describe('4. Home & List Pages Branches (home.ts)', () => {
	it('renderHomePage standard path', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const req = new Request('https://example.com/');
		const res = await testApp.fetch(req, env);
		expect(res.status).toBe(200);
	});

	it('renderPrivacyPage and renderTermsPage standard paths', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const res1 = await testApp.fetch(new Request('https://example.com/privacy'), env);
		expect(res1.status).toBe(200);

		const res2 = await testApp.fetch(new Request('https://example.com/terms'), env);
		expect(res2.status).toBe(200);
	});

	it('renderSpeechesPage cache hits, misses, query failures', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speech_index')) {
				return {
					success: true,
					results: [{ filename: 'speech-1', display_name: 'Speech 1' }],
				};
			}
			return { success: true, results: [] };
		};

		// 1. DB query fails
		{
			const env = createMockEnv(() => ({ success: false, results: [] }));
			const res = await testApp.fetch(new Request('https://example.com/speeches/'), env);
			expect(res.status).toBe(500);
		}

		// 2. Cache miss -> render -> write cache
		{
			const env = createMockEnv(resolver);
			const res = await testApp.fetch(new Request('https://example.com/speeches/'), env);
			expect(res.status).toBe(200);
			// R2 cache should have been written. The key format matches: `${version}/example.com/speeches/data-${dataToken}`
			// where dataToken contains number of items and hash.
			let hasSpeechesKey = false;
			for (const key of env.__r2Store.keys()) {
				if (key.includes('speeches/data-')) hasSpeechesKey = true;
			}
			expect(hasSpeechesKey).toBe(true);
		}

		// 3. Cache hit
		{
			const env = createMockEnv(resolver);
			// Render once to seed cache
			await testApp.fetch(new Request('https://example.com/speeches/'), env);
			// Now request again with the exact same DB resolver to get a cache hit
			const res = await testApp.fetch(new Request('https://example.com/speeches/'), env);
			expect(res.status).toBe(200);
		}
	});

	it('renderSpeakersPage cache hits, misses, query failures', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speakers')) {
				return {
					success: true,
					results: [{ id: 1, route_pathname: 'audrey', name: 'Audrey', photoURL: null }],
				};
			}
			return { success: true, results: [] };
		};

		// 1. DB query fails
		{
			const env = createMockEnv(() => ({ success: false, results: [] }));
			const res = await testApp.fetch(new Request('https://example.com/speakers/'), env);
			expect(res.status).toBe(500);
		}

		// 2. Cache miss -> render -> write cache
		{
			const env = createMockEnv(resolver);
			const res = await testApp.fetch(new Request('https://example.com/speakers/'), env);
			expect(res.status).toBe(200);
			let hasSpeakersKey = false;
			for (const key of env.__r2Store.keys()) {
				if (key.includes('speakers/')) hasSpeakersKey = true;
			}
			expect(hasSpeakersKey).toBe(true);
		}

		// 3. Cache hit
		{
			const env = createMockEnv(resolver);
			// Render once to seed cache
			await testApp.fetch(new Request('https://example.com/speakers/'), env);
			// Now request again with the exact same DB resolver to get a cache hit
			const res = await testApp.fetch(new Request('https://example.com/speakers/'), env);
			expect(res.status).toBe(200);
		}
	});

	it('handles R2 write failures gracefully', async () => {
		const resolver: QueryResolver = (sql) => {
			if (sql.includes('FROM speakers')) {
				return {
					success: true,
					results: [{ id: 1, route_pathname: 'audrey', name: 'Audrey', photoURL: null }],
				};
			}
			return { success: true, results: [] };
		};

		const env = createMockEnv(resolver);
		// Force SPEECH_CACHE.put to throw an error
		env.SPEECH_CACHE.put = async () => {
			throw new Error('R2 write failed');
		};

		const res = await testApp.fetch(new Request('https://example.com/speakers/'), env);
		expect(res.status).toBe(200); // Should handle R2 write failure gracefully and still return 200
	});
});
