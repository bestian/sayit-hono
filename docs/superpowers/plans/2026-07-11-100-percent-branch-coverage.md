# 100% Branch Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach actual 100% statements, branches, functions, and lines coverage across all 18 files in the codebase, and enforce it with `thresholds.branches = 100` and `perFile = true` in Vitest configuration.

**Architecture:** We will systematically address each file. For reachable branch arms (Type 1), we will write targeted test assertions in their respective module specs. For unreachable or redundant branches (Type 2), we will safely remove/simplify them from the production code. For instrumentation anomalies (Type 3), we will adjust the parameter and code layout to ensure the Istanbul coverage engine can correctly track them.

**Tech Stack:** Vitest 4.1.10, Hono 4.12.15, TypeScript, D1, R2

## Global Constraints
- Do not use any `/* istanbul ignore ... */` annotations, ignores, or dynamic denominator exclusions.
- Do not weaken the existing behavior contract or change the build pipeline.
- Run tests in worker environment using `vp test run --coverage`.

---

### Task 1: Coverage for src/ssr/pages/speech.ts

**Files:**
- Modify: `src/ssr/pages/speech.ts`
- Test: `test/ssr_routes.spec.ts`

**Interfaces:**
- Consumes: `renderSpeechPage`, `renderSectionPage`, `renderNestedSpeechPage`
- Produces: 100% branch coverage on speech rendering page handlers

- [ ] **Step 1: Write the failing tests for reachable branch arms**
Add the following tests to `test/ssr_routes.spec.ts` to cover lines 92, 96, 98, 127, 144, 150, 236, 237, 258, 259, 264, 278, 384, 388, 402, 417, 429, 471, 494, 502:
```typescript
describe('speech page branch coverages', () => {
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

- [ ] **Step 3: Simplify and remove impossible branches from src/ssr/pages/speech.ts**
Open `src/ssr/pages/speech.ts` and simplify impossible branches:
- Remove parameter default fallbacks where Honos router matches protect parameter presence (lines 107, 167, 168, 309).
- Remove fallback `response.ok && response.status < 400` inside R2 cache operations that return exact standard responses (lines 299, 439, 514).
- Clean up nullish coalescing on display name inputs that are guaranteed by DB structure (line 386).

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

- [ ] **Step 3: Simplify and remove impossible branches from src/api/upload_markdown.ts**
- Remove impossible marked output checks `typeof html === 'string'` (line 252).
- Remove fallback checks for batch meta changes (lines 474-479) since D1 batch driver always populates it on success.
- Clean up first-line null checks that are covered by prior loops (lines 552, 775).
- Structure loop final step to satisfy Istanbul (line 174).

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
- Test: `test/an_direct.spec.ts`

**Interfaces:**
- Consumes: `speechAn`, `serveAnByKey`, `getAnContentAsString`
- Produces: 100% branch coverage on `.an` API handlers

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/an_direct.spec.ts` to cover lines 31, 34, 35, 36, 47, 48, 192, 217, 261, 262, 276, 339, 340:
```typescript
describe('an branch coverage extra scenarios', () => {
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
Run: `vp test run test/an_direct.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/api/an.ts`, simplify branch line 36 arm 2 (`s.section_speaker ?? 'Unknown'`) as it is protected by line 34.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/an_direct.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/an.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/an.ts test/an_direct.spec.ts
git commit -m "test: cover and simplify branches in api/an"
```

---

### Task 4: Coverage for src/ssr/pages/speaker.ts

**Files:**
- Modify: `src/ssr/pages/speaker.ts`
- Test: `test/final_gaps.spec.ts`

**Interfaces:**
- Consumes: `renderSpeakerPage`
- Produces: 100% branch coverage on speaker rendering pages

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/final_gaps.spec.ts` to cover lines 73, 117, 118, 119, 121, 123, 132, 149, 161:
```typescript
describe('speaker SSR page extra branches', () => {
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
Run: `vp test run test/final_gaps.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/ssr/pages/speaker.ts`:
- Remove route param fallback check (line 38).
- Remove try/catch response verification block (line 161).

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/final_gaps.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/ssr/pages/speaker.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/ssr/pages/speaker.ts test/final_gaps.spec.ts
git commit -m "test: cover and simplify branches in pages/speaker"
```

---

### Task 5: Coverage for src/index.ts

**Files:**
- Modify: `src/index.ts`
- Test: `test/index_branches.spec.ts`
- Test: `test/index.spec.ts`

**Interfaces:**
- Consumes: app routing entrypoint
- Produces: 100% branch coverage on app router and index middleware

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/index_branches.spec.ts` to cover lines 53, 54, 55, 160, 319, 323, 326, 349, 353:
```typescript
describe('index edge routing branches', () => {
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
Run: `vp test run test/index_branches.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/index.ts`:
- Remove optional size branch check (line 147).
- Remove fallback `row.display_name ?? ''` since column is NOT NULL (line 272).

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/index_branches.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/index.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/index.ts test/index_branches.spec.ts test/index.spec.ts
git commit -m "test: cover and simplify branches in index.ts"
```

---

### Task 6: Coverage for src/ssr/pages/search.ts

**Files:**
- Modify: `src/ssr/pages/search.ts`
- Test: `test/search_branches.spec.ts`

**Interfaces:**
- Consumes: `renderSearchPage`
- Produces: 100% branch coverage on search render pages

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/search_branches.spec.ts` to cover lines 98, 110, 129, 130:
```typescript
describe('search page rendering branch edge cases', () => {
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
Run: `vp test run test/search_branches.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/ssr/pages/search.ts`:
- Remove speaker name fallback (line 142) and section content fallback (line 263).
- Restructure default arguments (lines 118, 119) to standard declarations inside the function body so they do not skip instrumentation.

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/search_branches.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/ssr/pages/search.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/ssr/pages/search.ts test/search_branches.spec.ts
git commit -m "test: cover and simplify branches in pages/search"
```

---

### Task 7: Coverage for src/api/speaker_detail.ts

**Files:**
- Modify: `src/api/speaker_detail.ts`
- Test: `test/final_gap_close.spec.ts`

**Interfaces:**
- Consumes: `speakerDetail`
- Produces: 100% branch coverage on speaker details API

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/final_gap_close.spec.ts` to cover lines 46, 53, 94, 95, 98, 102, 111:
```typescript
describe('speakerDetail branch coverage extra cases', () => {
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
Run: `vp test run test/final_gap_close.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/api/speaker_detail.ts`, remove route parameter fallback check (line 12).

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/final_gap_close.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/speaker_detail.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/speaker_detail.ts test/final_gap_close.spec.ts
git commit -m "test: cover and simplify branches in api/speaker_detail"
```

---

### Task 8: Coverage for src/api/md.ts

**Files:**
- Modify: `src/api/md.ts`
- Test: `test/md.spec.ts`
- Test: `test/md_routes.spec.ts`

**Interfaces:**
- Consumes: `serveMdByKey`
- Produces: 100% branch coverage on markdown generation API

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/md.spec.ts` and `test/md_routes.spec.ts` to cover lines 49, 151, 181, 196, 252, 279:
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
          <p>line1

line2</p>
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

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/api/md.ts`, remove `closeMatch.index !== undefined` check as JS regex matching guarantees it (line 75).

- [ ] **Step 4: Run test to verify it passes**
Run: `vp test run test/md.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/md.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/api/md.ts test/md.spec.ts test/md_routes.spec.ts
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

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/api/cache.ts`:
- Restructure default arguments to avoid function default parameter skips (line 61).
- Remove `typeof object.size === 'number'` fallback (line 94).

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

- [ ] **Step 3: Simplify and remove impossible branches**
- Remove D1 results wrapper fallback (line 127).
- Remove fallback check `row.section_content ?? ''` since the column is NOT NULL (line 133).

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

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/api/og_routes.ts`, remove route parameter fallback (line 72).

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
- Test: `test/ssr_routes.spec.ts`

**Interfaces:**
- Consumes: home pages SSR renderers
- Produces: 100% branch coverage on home pages rendering handlers

- [ ] **Step 1: Write the failing tests**
Verify that home rendering covers standard flows. Since the uncovered branch is impossible code path:
- Line 99: `response.ok && response.status < 400`
- Line 129: `response.ok && response.status < 400`
Both are unreachable because `readR2Cache` catches R2 errors internally and returns standard successful Responses or null.

- [ ] **Step 2: Simplify and remove impossible branches**
Open `src/ssr/pages/home.ts` and simplify lines 99 and 129:
Change `if (response.ok && response.status < 400)` to `if (response)`.

- [ ] **Step 3: Run tests to verify they pass**
Run: `vp test run test/ssr_routes.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/ssr/pages/home.ts`.

- [ ] **Step 4: Commit**
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

- [ ] **Step 3: Simplify and remove impossible branches**
In `src/search/docBuilder.ts`, remove first-line fallback (line 19) since it is validated prior.

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
- Test: `test/read_api_routes.spec.ts`

**Interfaces:**
- Consumes: `speechContent`
- Produces: 100% branch coverage on speech content retrieval API

- [ ] **Step 1: Write the failing tests**
Verify standard paths are fully covered.

- [ ] **Step 2: Simplify and remove impossible branches**
In `src/api/speech.ts`, remove line 14 fallback `parts[0] ?? ''` since Hono route regex matches guarantee it.

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
- Test: `test/final_gap_close.spec.ts`

**Interfaces:**
- Consumes: `speechIndex`
- Produces: 100% branch coverage on speech index retrieval API

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/final_gap_close.spec.ts` to cover line 17:
```typescript
describe('speechIndex branch coverage extra cases', () => {
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
Run: `vp test run test/final_gap_close.spec.ts`
Expected: FAIL or missing coverage

- [ ] **Step 3: Run test to verify it passes**
Run: `vp test run test/final_gap_close.spec.ts --coverage`
Expected: PASS and 100% branch coverage on `src/api/speech_index.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/api/speech_index.ts test/final_gap_close.spec.ts
git commit -m "test: cover and simplify branches in api/speech_index"
```

---

### Task 17: Coverage for src/utils/sectionPatch.ts

**Files:**
- Modify: `src/utils/sectionPatch.ts`
- Test: `test/upload_markdown_unit.spec.ts`

**Interfaces:**
- Consumes: `sectionMatchKey`
- Produces: 100% branch coverage on section patch utilities

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/upload_markdown_unit.spec.ts` to cover line 134:
```typescript
import { sectionMatchKey } from '../src/utils/sectionPatch';

describe('sectionMatchKey extra branches', () => {
	it('matches SVG keys without speaker details', () => {
		const key = sectionMatchKey({ speaker: null, markdown: '<svg></svg>' });
		expect(key).toBe(' __embedded_svg__');
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
- Test: `test/md.spec.ts`

**Interfaces:**
- Consumes: `decodeHtmlEntities`
- Produces: 100% branch coverage on text utilities

- [ ] **Step 1: Write the failing tests**
Add the following tests to `test/md.spec.ts` to cover line 48:
```typescript
import { decodeHtmlEntities } from '../src/utils/textUtils';

describe('decodeHtmlEntities extra branches', () => {
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
