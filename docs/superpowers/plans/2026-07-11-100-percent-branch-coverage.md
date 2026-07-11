# 100% Branch Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach actual 100% statements, branches, functions, and lines coverage across all 18 files in the codebase, and enforce it with `thresholds.branches = 100` and `perFile = true` in Vitest configuration.

**Architecture:** We will systematically address each file. For reachable branch arms (Type 1), we will write targeted test assertions in their respective behavior-owning specs. For unreachable or redundant branches (Type 2), we will treat them as hypotheses and verify them against actual types/callers/schema before simplification. If they cannot be proven unreachable, we will write a reachable boundary/error test instead. Instrumentation anomalies (Type 3) will be resolved via minor structural changes. No new tests will be added to the coverage-theater files (`final_gaps.spec.ts`, `final_gap_close.spec.ts`, `index_branches.spec.ts`, `search_branches.spec.ts`, `heads_branches.spec.ts`).

**Tech Stack:** Vitest 4.1.10, Hono 4.12.15, TypeScript, D1, R2

## Global Constraints
- Do not use any `/* istanbul ignore ... */` annotations, ignores, or dynamic denominator exclusions.
- Do not weaken the existing behavior contract or change the build pipeline.
- Remap every new test to the nearest behavior-owning spec. No catch-all coverage files are allowed.
- Run tests in worker environment using `vp test run --coverage`.

---

### Task 1: Coverage for src/ssr/pages/speech.ts

**Files:**
- Modify: `src/ssr/pages/speech.ts`
- Test: `test/ssr_routes.spec.ts` (Behavior-owning spec for SSR page routing)

**Interfaces:**
- Consumes: `renderSpeechPage`, `renderSectionPage`, `renderNestedSpeechPage`
- Produces: 100% branch coverage on speech rendering page handlers

- [ ] **Step 1: Write the failing tests for reachable branch arms**
Add the following tests to `test/ssr_routes.spec.ts` under the existing `describe('SSR /:filename', ...)` blocks to cover lines 92, 96, 98, 127, 144, 150, 236, 237, 258, 259, 264, 278, 384, 388, 402, 417, 429, 471, 494, 502:
```typescript
describe('speech page branch coverages (remap to ssr_routes)', () => {
	it('handles alternate info with missing display name', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
				return { success: true, results: [{ alternate_filename: '2026-flat-en' }] };
			}
			return flatResolver(sql, args);
		});
		const { res } = await dispatch('/2026-flat', env);
		expect(res.status).toBe(200);
	});

	it('handles non-CJK alternate languages', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_index si') && sql.includes('alternate_filename')) {
				return { success: true, results: [{ alternate_filename: '2026-flat-en', alternate_display_name: 'English Title' }] };
			}
			return flatResolver(sql, args);
		});
		const { res } = await dispatch('/2026-flat', env);
		expect(res.status).toBe(200);
	});

	it('serves cached section page without custom metadata tags', async () => {
		const cacheKey = `${CACHE_KEY_VERSION}/example.com/speech/101`;
		const env = createMockEnv(flatResolver, {
			preSeedR2: { [cacheKey]: { body: '<p>cached</p>' } }
		});
		const { res } = await dispatch('/speech/101', env);
		expect(res.status).toBe(200);
	});

	it('renders section with media content (empty plain text)', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) {
				return {
					success: true,
					results: [{ section_id: 101, section_speaker: 'audrey', section_content: '<iframe src="..."></iframe>', display_name: 'Media Section' }]
				};
			}
			return flatResolver(sql, args);
		});
		const { res } = await dispatch('/speech/101', env);
		expect(res.status).toBe(200);
	});

	it('renders section with short content (no ellipsis)', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_content a') && sql.includes('WHERE a.section_id = ?')) {
				return {
					success: true,
					results: [{ section_id: 101, section_speaker: 'audrey', section_content: '<p>Short</p>', display_name: 'Short Section' }]
				};
			}
			return flatResolver(sql, args);
		});
		const { res } = await dispatch('/speech/101', env);
		expect(res.status).toBe(200);
	});

	it('omits twitter script when no twitter widget in section content', async () => {
		const env = createMockEnv(flatResolver);
		const { res } = await dispatch('/speech/101', env);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).not.toContain('widgets.js');
	});

	it('renders nested speech with missing displays and preview query failures', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('GROUP BY nest_filename')) {
				return {
					success: true,
					results: [{ nest_filename: 'sub1', nest_display_name: null, section_count: 5, first_section_id: 50 }]
				};
			}
			if (sql.includes('section_content FROM speech_content WHERE section_id IN')) {
				return { success: false, results: [] };
			}
			return flatResolver(sql, args);
		});
		const { res } = await dispatch('/2026-nested', env);
		expect(res.status).toBe(200);
	});

	it('handles single speech rendering fallbacks', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_content sc') && sql.includes('WHERE sc.filename = ?') && !sql.includes('GROUP BY')) {
				return {
					success: true,
					results: [{
						filename: '2026-flat',
						section_id: 1,
						previous_section_id: null,
						next_section_id: null,
						section_speaker: 'audrey-tang',
						section_content: '<p>hello</p>',
						photoURL: null,
						name: null
					}]
				};
			}
			if (sql.includes('FROM speech_index WHERE filename = ?')) {
				return {
					success: true,
					results: [{ filename: '2026-flat', display_name: null, isNested: 0, nest_filenames: null, nest_display_names: null }]
				};
			}
			return flatResolver(sql, args);
		});
		const { res } = await dispatch('/2026-flat', env);
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/ssr_routes.spec.ts`
Expected: FAIL or missing coverage on these branches

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Lines 107, 167, 168, 309)*: The Honos router regex matches guarantee parameter presence. Let's verify by auditing Hono routes. Since they match, these parameter default fallbacks can be safely deleted.
- *Hypothesis 2 (Lines 299, 439, 514)*: The controllers catch DB errors and return 500 directly, meaning `response.ok` check is redundant. Let's verify. If Hono's `c.html` response can never fail dynamically, simplify to `if (response)`.
- Apply updates to `src/ssr/pages/speech.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/ssr_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/ssr/pages/speech.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/ssr/pages/speech.ts test/ssr_routes.spec.ts
git commit -m "test: cover and simplify branches in pages/speech"
```

---

### Task 2: Coverage for src/api/upload_markdown.ts

**Files:**
- Modify: `src/api/upload_markdown.ts`
- Test: `test/upload_markdown_unit.spec.ts`
- Test: `test/upload_markdown_integration.spec.ts`

**Interfaces:**
- Consumes: `uploadMarkdown`
- Produces: 100% branch coverage on upload markdown handlers

- [ ] **Step 1: Write the failing tests**
In `test/upload_markdown_unit.spec.ts` and `test/upload_markdown_integration.spec.ts`, write tests to cover the following:
- Verify that a speaker who is not "唐鳳" doesn't map to "唐鳳-3" (line 102).
- Verify empty paragraph and whitespaces behavior (line 146).
- Verify parsing when the first line is not a `# Title` header (line 258).
- Verify execution without worker cache invalidations (skip purge) (line 359).
- Verify PATCH with empty alternate filename falls back to null (line 831).
- Verify display name fallback to filename (line 614, 845).
Ensure D1 results mocks return empty arrays safely (lines 449, 454, 603).

Add these tests to `test/upload_markdown_unit.spec.ts`:
```typescript
describe('upload_markdown branch coverage extras', () => {
	it('normalizes speaker names correctly and skips Tang Feng mapping for others', async () => {
		const env = createMockEnv(demoSpeechResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'test-speaker', markdown: '# Title
## Audrey:
hi' })
		});
		expect(res.status).toBe(200);
	});

	it('handles content without title headers', async () => {
		const env = createMockEnv(demoSpeechResolver());
		const { res } = await dispatch('/api/upload_markdown', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'test-no-title', markdown: '## Audrey:
hi' })
		});
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/upload_markdown_unit.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 252)*: `marked.parse` returns a string for standard inputs. Simplify `typeof html === 'string'` check to direct string input type.
- *Hypothesis 2 (Lines 474-479)*: D1 batch results metadata change counts. Verify if D1 driver always populates it on success. If so, clean up nullish coalescing to avoid redundant fallbacks.
- Apply updates to `src/api/upload_markdown.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/upload_markdown_unit.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/upload_markdown.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/upload_markdown.ts test/upload_markdown_unit.spec.ts test/upload_markdown_integration.spec.ts
git commit -m "test: cover and simplify branches in upload_markdown"
```

---

### Task 3: Coverage for src/api/an.ts

**Files:**
- Modify: `src/api/an.ts`
- Test: `test/an.spec.ts` (Remapped from final_gap_close / an_direct)

**Interfaces:**
- Consumes: `speechAn`, `serveAnByKey`, `getAnContentAsString`
- Produces: 100% branch coverage on `.an` API handlers

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/an.spec.ts` to cover lines 31, 34, 35, 36, 47, 48, 192, 217, 261, 262, 276, 339, 340:
```typescript
describe('an branch coverage extra scenarios (remapped to an.spec.ts)', () => {
	it('generates an with null display name and missing speaker name', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [
						{
							section_id: 1,
							previous_section_id: null,
							next_section_id: null,
							section_speaker: 'audrey',
							section_content: null,
							display_name: null,
							name: null
						}
					]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/an/2026-demo.an', env);
		expect(res.status).toBe(200);
	});

	it('serves cached an with unallowed origin and custom tags', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }), {
			preSeedR2: { 'an/2026-demo': { body: '<xml></xml>', customMetadata: { cacheTag: 'speech:2026-demo' } } }
		});
		const { res } = await dispatch('/api/an/2026-demo.an', env, {
			headers: { Origin: 'https://evil.com' }
		});
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/an.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 36 arm 2)*: `s.section_speaker ?? 'Unknown'` is protected by line 34. Let's verify by auditing schema rules. Safe to simplify.
- Apply updates to `src/api/an.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/an.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/an.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/an.ts test/an.spec.ts
git commit -m "test: cover and simplify branches in api/an"
```

---

### Task 4: Coverage for src/ssr/pages/speaker.ts

**Files:**
- Modify: `src/ssr/pages/speaker.ts`
- Test: `test/ssr_routes.spec.ts` (Remapped from final_gaps)

**Interfaces:**
- Consumes: `renderSpeakerPage`
- Produces: 100% branch coverage on speaker rendering pages

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/ssr_routes.spec.ts` under speaker blocks to cover lines 73, 117, 118, 119, 121, 123, 132, 149, 161:
```typescript
describe('speaker SSR page extra branches (remapped to ssr_routes)', () => {
	it('handles speaker details with negative/invalid page numbers and missing content', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speakers_view')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							route_pathname: 'audrey',
							name: 'Audrey',
							photoURL: null,
							appearances_count: null,
							sections_count: null,
							longest_section_id: null,
							longest_section_content: null,
							longest_section_filename: null,
							longest_section_displayname: null
						}
					]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/speaker/audrey?page=-5', env);
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/ssr_routes.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 38)*: Route param fallback is structurally dead because Honos router ensures parameter match. Verify and simplify.
- *Hypothesis 2 (Line 161)*: The try/catch response verification block can be simplified if DB errors are fully caught. Verify.
- Apply updates to `src/ssr/pages/speaker.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/ssr_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/ssr/pages/speaker.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/ssr/pages/speaker.ts test/ssr_routes.spec.ts
git commit -m "test: cover and simplify branches in pages/speaker"
```

---

### Task 5: Coverage for src/index.ts

**Files:**
- Modify: `src/index.ts`
- Test: `test/index.spec.ts` (Remapped from index_branches)

**Interfaces:**
- Consumes: app routing entrypoint
- Produces: 100% branch coverage on app router and index middleware

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/index.spec.ts` to cover lines 53, 54, 55, 160, 319, 323, 326, 349, 353:
```typescript
describe('index edge routing branches (remapped to index.spec.ts)', () => {
	it('handles non-canonical redirect matching files with dots', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/speech/text.xml', env);
		expect(res.status).toBe(400);
	});

	it('purges cache with truncated listings', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		let count = 0;
		env.SPEECH_CACHE.list = async () => {
			count++;
			return {
				objects: count === 1 ? [{ key: 'k1' }] : [],
				truncated: count === 1,
				cursor: count === 1 ? 'next-cursor' : ''
			};
		};
		const { res } = await dispatch('/api/purge_cache', env, {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey' }
		});
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/index.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 147)*: R2 object size is always numeric. Verify and remove optional size check fallback.
- *Hypothesis 2 (Line 272)*: `row.display_name` is non-null. Verify D1 schema and remove redundant coalescing.
- Apply updates to `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/index.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/index.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/index.ts test/index.spec.ts
git commit -m "test: cover and simplify branches in index.ts"
```

---

### Task 6: Coverage for src/ssr/pages/search.ts

**Files:**
- Modify: `src/ssr/pages/search.ts`
- Test: `test/ssr_routes.spec.ts` (Remapped from search_branches)

**Interfaces:**
- Consumes: `renderSearchPage`
- Produces: 100% branch coverage on search render pages

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/ssr_routes.spec.ts` to cover lines 98, 110, 129, 130:
```typescript
describe('search page rendering branch edge cases (remapped to ssr_routes)', () => {
	it('handles extreme query pagination fallbacks', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/search/?q=needle&page=0&limit=0', env);
		expect(res.status).toBe(200);
	});

	it('creates plain text snippet for query matching at the end of long text', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [{
						filename: 'demo',
						section_id: 1,
						section_content: '<p>' + 'A '.repeat(100) + 'needle</p>',
						display_name: 'Demo title',
						speaker_name: 'Audrey',
						photoURL: null
					}]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/search/?q=needle', env);
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/ssr_routes.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 142)*: Speaker name constraint in DB. Verify schema definition. Delete fallback if redundant.
- *Hypothesis 2 (Line 263)*: `section_content` is NOT NULL. Verify schema and simplify.
- Restructure default arguments in search.ts (lines 118, 119) to standard declarations.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/ssr_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/ssr/pages/search.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/ssr/pages/search.ts test/ssr_routes.spec.ts
git commit -m "test: cover and simplify branches in pages/search"
```

---

### Task 7: Coverage for src/api/speaker_detail.ts

**Files:**
- Modify: `src/api/speaker_detail.ts`
- Test: `test/read_api_routes.spec.ts` (Remapped from final_gap_close)

**Interfaces:**
- Consumes: `speakerDetail`
- Produces: 100% branch coverage on speaker details API

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/read_api_routes.spec.ts` to cover lines 46, 53, 94, 95, 98, 102, 111:
```typescript
describe('speakerDetail branch coverage extra cases (remapped to read_api_routes)', () => {
	it('handles speaker details with missing counts and fallback length calculation', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speakers_view')) {
				return {
					success: true,
					results: [
						{
							id: 1,
							route_pathname: 'audrey',
							name: 'Audrey',
							photoURL: null,
							appearances_count: null,
							sections_count: null,
							longest_section_id: null,
							longest_section_content: null,
							longest_section_filename: null,
							longest_section_displayname: null
						}
					]
				};
			}
			if (sql.includes('COUNT(DISTINCT speech_filename)')) {
				return { success: true, results: [{ count: 'invalid-nan' }] };
			}
			if (sql.includes('COUNT(DISTINCT section_id)')) {
				return { success: true, results: [{ count: 'invalid-nan' }] };
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/speaker_detail/audrey.json', env);
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/read_api_routes.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 12)*: Parameter presence check is redundant. Audit and remove.
- Apply updates to `src/api/speaker_detail.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/read_api_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/speaker_detail.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/speaker_detail.ts test/read_api_routes.spec.ts
git commit -m "test: cover and simplify branches in api/speaker_detail"
```

---

### Task 8: Coverage for src/api/md.ts

**Files:**
- Modify: `src/api/md.ts`
- Test: `test/md.spec.ts`

**Interfaces:**
- Consumes: `serveMdByKey`
- Produces: 100% branch coverage on markdown generation API

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/md.spec.ts` to cover lines 49, 151, 181, 196, 252, 279:
```typescript
describe('md branch coverage extra assertions', () => {
	it('handles empty content and malformed TLCPerson tags', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso>
  <debate>
    <meta>
      <references>
        <TLCPerson id="audrey"/>
      </references>
    </meta>
    <debateBody>
      <debateSection>
        <heading>Demo</heading>
        <speech by="#audrey">
          <p></p>
        </speech>
      </debateSection>
    </debateBody>
  </debate>
</akomaNtoso>`;
		const md = __test__.an2md(xml);
		expect(md).toContain('### audrey');
	});

	it('formats quotes with empty lines correctly', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso>
  <debate>
    <meta>
      <references>
        <TLCPerson id="Unknown" showAs="Unknown"/>
      </references>
    </meta>
    <debateBody>
      <debateSection>
        <speech by="#Unknown">
          <p>line1\n\nline2</p>
        </speech>
      </debateSection>
    </debateBody>
  </debate>
</akomaNtoso>`;
		const md = __test__.an2md(xml);
		expect(md).toContain('>');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/md.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 75)*: Close match regex guarantees index. Audit regex matching logic. Delete index undefined verification.
- Apply updates to `src/api/md.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/md.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/md.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/md.ts test/md.spec.ts
git commit -m "test: cover and simplify branches in api/md"
```

---

### Task 9: Coverage for src/api/cache.ts

**Files:**
- Modify: `src/api/cache.ts`
- Test: `test/cache_unit.spec.ts`

**Interfaces:**
- Consumes: cache API helpers
- Produces: 100% branch coverage on cache utility handlers

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/cache_unit.spec.ts` to cover lines 119, 180, 197:
```typescript
describe('cache utility branch coverages', () => {
	it('handles write cache without contentType and format speaker route path without slash', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const response = new Response('ok');
		await writeR2Cache(env.SPEECH_CACHE, 'key-nocontent', response);
		expect(env.__r2Store.has('key-nocontent')).toBe(true);

		const path = speakerRequestPath('audrey-tang');
		expect(path).toBe('/speaker/audrey-tang');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/cache_unit.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 94)*: Size check is always numeric on active R2 objects. Verify R2 typings. Simplify.
- Restructure default arguments (line 61).
- Apply updates to `src/api/cache.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/cache_unit.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/cache.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/cache.ts test/cache_unit.spec.ts
git commit -m "test: cover and simplify branches in api/cache"
```

---

### Task 10: Coverage for src/search/runtime.ts

**Files:**
- Modify: `src/search/runtime.ts`
- Test: `test/search_runtime.spec.ts`

**Interfaces:**
- Consumes: `buildSearchDocsForSpeech`
- Produces: 100% branch coverage on search runtime helpers

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/search_runtime.spec.ts` to cover lines 131, 132, 134:
```typescript
describe('search runtime buildSearchDocsForSpeech branches', () => {
	it('handles previous/next null values and missing display names', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [{
						filename: 'demo',
						nest_filename: null,
						section_id: 1,
						previous_section_id: null,
						next_section_id: null,
						section_content: 'content',
						display_name: null,
						name: null
					}]
				};
			}
			return { success: true, results: [] };
		});
		const docs = await buildSearchDocsForSpeech(createContext(env.SPEECH_CACHE), 'demo');
		expect(docs).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/search_runtime.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 133)*: `section_content` database constraint is NOT NULL. Verify schema and simplify.
- Remove D1 results wrapper fallback (line 127).
- Apply updates to `src/search/runtime.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/search_runtime.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/search/runtime.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/search/runtime.ts test/search_runtime.spec.ts
git commit -m "test: cover and simplify branches in search/runtime"
```

---

### Task 11: Coverage for src/api/og_routes.ts

**Files:**
- Modify: `src/api/og_routes.ts`
- Test: `test/og_routes.spec.ts`

**Interfaces:**
- Consumes: `handleOgSpeechImage`
- Produces: 100% branch coverage on OG routing endpoints

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/og_routes.spec.ts` to cover lines 59, 108:
```typescript
describe('og routes branch coverages', () => {
	it('handles content-type fallback and missing speech title', async () => {
		const { ctx } = makeContext({
			url: 'https://placeholder.host/og/speech/42.png',
			params: { section_id: '42.png' },
			resolver: (sql, args) => {
				if (sql.includes('FROM speech_content a') && args[0] === 42) {
					return {
						success: true,
						results: [{
							filename: 'demo',
							section_id: 42,
							section_content: 'content',
							photoURL: '/avatar.png',
							display_name: null,
							name: 'Audrey'
						}]
					};
				}
				return { success: true, results: [] };
			},
			assetsFetch: async () => new Response('avatar', { headers: { 'content-type': '' } })
		});
		const res = await handleOgSpeechImage(ctx, ogLoader);
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/og_routes.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 72)*: Router regex guarantees presence of parameter. Simplify fallback.
- Apply updates to `src/api/og_routes.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/og_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/og_routes.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/og_routes.ts test/og_routes.spec.ts
git commit -m "test: cover and simplify branches in api/og_routes"
```

---

### Task 12: Coverage for src/ssr/pages/home.ts

**Files:**
- Modify: `src/ssr/pages/home.ts`
- Test: `test/ssr_routes.spec.ts` (Remapped from home_branches)

**Interfaces:**
- Consumes: home pages SSR renderers
- Produces: 100% branch coverage on home pages rendering handlers

- [ ] **Step 1: Write a behavioral test before simplifying the source**
Add a test in `test/ssr_routes.spec.ts` that asserts the standard caching behavior (verifying that a successful render writes to R2):
```typescript
describe('home page render caching behavior before simplification', () => {
	it('writes the rendered home layout response to R2 cache when successful', async () => {
		const env = createMockEnv(() => ({ success: true, results: [] }));
		const { res } = await dispatch('/speeches/', env);
		expect(res.status).toBe(200);
		// Verify R2 was written
		const keys = Array.from(env.__r2Store.keys());
		expect(keys.some(k => k.includes('speeches/data-'))).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify standard cache write behavior**
Run: `vp test run test/ssr_routes.spec.ts`
Expected: PASS

- [ ] **Step 3: Verify simplification hypothesis**
- *Hypothesis 1 (Lines 99, 129)*: `response.ok && response.status < 400` is redundant because `readR2Cache` handles R2 reads and Hono `c.html()` always yields 200 response. If we want to guard against writeR2Cache being called for errors, we should keep the check but write a test that mocks `c.html` to return a 500 status (skipping cache write). If `c.html` is proven structurally infallible in standard Hono SSR, simplify the check to `if (response)`.
- Open `src/ssr/pages/home.ts` and simplify lines 99 and 129 to `if (response)` or add the fallback tests.

- [ ] **Step 4: Run test to verify cache write behavior after simplification**
Run: `vp test run test/ssr_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/ssr/pages/home.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/ssr/pages/home.ts test/ssr_routes.spec.ts
git commit -m "test: cover and simplify branches in pages/home"
```

---

### Task 13: Coverage for src/search/docBuilder.ts

**Files:**
- Modify: `src/search/docBuilder.ts`
- Test: `test/docBuilder.spec.ts`

**Interfaces:**
- Consumes: `docsFromSections`, `docsFromMarkdown`
- Produces: 100% branch coverage on document builders

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/docBuilder.spec.ts` to cover line 101:
```typescript
describe('docBuilder extra branches', () => {
	it('handles sections with empty content', () => {
		const doc = docsFromSections([{
			filename: 'demo',
			nest_filename: null,
			section_id: 1,
			section_content: '',
			display_name: 'Title',
			name: 'Audrey'
		}], 'https://example.com');
		expect(doc).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/docBuilder.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 19)*: Title extraction fallback is covered prior. Simplify line 19 fallback.
- Apply updates to `src/search/docBuilder.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/docBuilder.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/search/docBuilder.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/search/docBuilder.ts test/docBuilder.spec.ts
git commit -m "test: cover and simplify branches in search/docBuilder"
```

---

### Task 14: Coverage for src/api/rss.ts

**Files:**
- Modify: `src/api/rss.ts`
- Test: `test/rss_edges.spec.ts`

**Interfaces:**
- Consumes: `rssFeed`
- Produces: 100% branch coverage on RSS feed generation API

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/rss_edges.spec.ts` to cover line 43:
```typescript
describe('rss edges branch extra tests', () => {
	it('truncates summaries without softCut boundary when single word is too long', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_content sc')) {
				return {
					success: true,
					results: [{
						filename: '2026-demo',
						nest_filename: null,
						section_id: 1,
						section_speaker: 'audrey',
						section_content: 'A'.repeat(300),
						display_name: 'Title',
						pubDate: '2026-07-11'
					}]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/rss.xml', env);
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/rss_edges.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Run test to verify it passes**
Run: `vp test run test/rss_edges.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/rss.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/api/rss.ts test/rss_edges.spec.ts
git commit -m "test: cover and simplify branches in api/rss"
```

---

### Task 15: Coverage for src/api/speech.ts

**Files:**
- Modify: `src/api/speech.ts`
- Test: `test/read_api_routes.spec.ts` (Remapped from speech_branches)

**Interfaces:**
- Consumes: `speechContent`
- Produces: 100% branch coverage on speech content retrieval API

- [ ] **Step 1: Verify standard paths are covered**
Verify by running existing routes tests.

- [ ] **Step 2: Verify and resolve source simplification hypotheses**
- *Hypothesis 1 (Line 14)*: Route regex checks guarantee parameter presence. Audit and delete parameter check.
- Apply updates to `src/api/speech.ts`.

- [ ] **Step 3: Run tests to verify they pass**
Run: `vp test run test/read_api_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/speech.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/api/speech.ts test/read_api_routes.spec.ts
git commit -m "test: simplify branches in api/speech"
```

---

### Task 16: Coverage for src/api/speech_index.ts

**Files:**
- Modify: `src/api/speech_index.ts`
- Test: `test/read_api_routes.spec.ts` (Remapped from final_gap_close)

**Interfaces:**
- Consumes: `speechIndex`
- Produces: 100% branch coverage on speech index retrieval API

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/read_api_routes.spec.ts` to cover line 17:
```typescript
describe('speechIndex branch coverage extra cases (remapped to read_api_routes)', () => {
	it('handles non-array json parse fallbacks', async () => {
		const env = createMockEnv((sql, args) => {
			if (sql.includes('FROM speech_index')) {
				return {
					success: true,
					results: [{
						filename: 'demo',
						display_name: 'Title',
						isNested: 0,
						nest_filenames: '{"key": "value"}',
						nest_display_names: '{"key": "value"}'
					}]
				};
			}
			return { success: true, results: [] };
		});
		const { res } = await dispatch('/api/speech_index.json', env);
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/read_api_routes.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Run test to verify it passes**
Run: `vp test run test/read_api_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/speech_index.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/api/speech_index.ts test/read_api_routes.spec.ts
git commit -m "test: cover and simplify branches in api/speech_index"
```

---

### Task 17: Coverage for src/utils/sectionPatch.ts

**Files:**
- Modify: `src/utils/sectionPatch.ts`
- Test: `test/upload_markdown_unit.spec.ts` (LCS logic spec)

**Interfaces:**
- Consumes: `sectionMatchKey`
- Produces: 100% branch coverage on section patch utilities

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/upload_markdown_unit.spec.ts` to cover line 134:
```typescript
import { sectionMatchKey } from '../src/utils/sectionPatch';

describe('sectionMatchKey extra branches (remapped to upload_markdown_unit)', () => {
	it('matches SVG keys without speaker details', () => {
		const key = sectionMatchKey({ speaker: null, markdown: '<svg></svg>' });
		expect(key).toBe('\u0000__embedded_svg__');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/upload_markdown_unit.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Run test to verify it passes**
Run: `vp test run test/upload_markdown_unit.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/utils/sectionPatch.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/utils/sectionPatch.ts test/upload_markdown_unit.spec.ts
git commit -m "test: cover and simplify branches in utils/sectionPatch"
```

---

### Task 18: Coverage for src/utils/textUtils.ts

**Files:**
- Modify: `src/utils/textUtils.ts`
- Test: `test/md.spec.ts` (Text/markup extraction spec)

**Interfaces:**
- Consumes: `decodeHtmlEntities`
- Produces: 100% branch coverage on text utilities

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/md.spec.ts` to cover line 48:
```typescript
import { decodeHtmlEntities } from '../src/utils/textUtils';

describe('decodeHtmlEntities extra branches (remapped to md.spec.ts)', () => {
	it('ignores unknown named entities', () => {
		const decoded = decodeHtmlEntities('Hello &foo;');
		expect(decoded).toBe('Hello &foo;');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `vp test run test/md.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Run test to verify it passes**
Run: `vp test run test/md.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/utils/textUtils.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/utils/textUtils.ts test/md.spec.ts
git commit -m "test: cover and simplify branches in utils/textUtils"
```

---

### Task 19: Enable 100% Branch Coverage Enforcement

**Files:**
- Modify: `vitest.config.mts`

**Interfaces:**
- Consumes: None
- Produces: Strict branch coverage thresholds in Vitest config

- [ ] **Step 1: Write the config changes**
Open `vitest.config.mts` and locate `thresholds` inside the coverage block:
```typescript
			thresholds: {
				statements: 100,
				branches: 100,
				lines: 100,
				functions: 100,
				perFile: true,
			},
```
Ensure `branches` is set to 100.

- [ ] **Step 2: Run all checks to verify it passes**
Run: `bun run check`
Expected: PASS

Run: `bun run test:coverage`
Expected: PASS with 100% across all metrics (statements, branches, functions, lines) on all files.

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add vitest.config.mts
git commit -m "chore: enable strict 100% branch coverage enforcement"
```
