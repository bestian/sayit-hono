# Workers Cache Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Cloudflare's new front-of-Worker Workers Cache for `sayit-hono` to offload CPU rendering and dynamically purge edge cache on uploads using cache tags.

**Architecture:** Enable `cache.enabled` in `wrangler.jsonc`. Update `withCacheHeaders` in `src/index.ts` to accept and set `Cache-Tag` on HTML responses. Implement `purgeWorkersCache` in `src/api/cache.ts` using the new `ctx.cache.purge` API. Update the markdown sync invalidation paths in `src/api/upload_markdown.ts` to call the purge helper.

**Tech Stack:** Cloudflare Workers, Hono, TypeScript, Vitest

## Global Constraints
- Do not break local development or test runner (fallback gracefully when `ctx.cache` is undefined).
- Cache-Tags must use URI-encoded speech filenames and speaker routes to avoid invalid characters in headers.
- All non-GET routes must remain uncacheable.

---

### Task 1: Enable Config and Implement Purge Helper

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `src/api/cache.ts`

**Interfaces:**
- Produces: `purgeWorkersCache(ctx: any, options: { tags?: string[]; paths?: string[]; purgeEverything?: boolean }): Promise<void>`

- [ ] **Step 1: Enable Workers Cache in wrangler.jsonc**
Verify that `"cache": { "enabled": true }` is present in `wrangler.jsonc` (already done).

- [ ] **Step 2: Add purgeWorkersCache helper to src/api/cache.ts**
Add the `purgeWorkersCache` helper to `src/api/cache.ts` that safely checks if `ctx.cache.purge` is a function before calling it.

```typescript
export async function purgeWorkersCache(
	ctx: any,
	options: { tags?: string[]; paths?: string[]; purgeEverything?: boolean }
): Promise<void> {
	try {
		if (ctx && ctx.cache && typeof ctx.cache.purge === 'function') {
			console.log('[workers cache] purging', options);
			await ctx.cache.purge(options);
		} else {
			console.log('[workers cache] purge skipped: API not available in current environment');
		}
	} catch (err) {
		console.error('[workers cache] purge error', err);
	}
}
```

- [ ] **Step 3: Run typecheck to verify compiling**
Run: `bun run typecheck`
Expected: PASS

---

### Task 2: Update HTML and SSR Page Cache Headers

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update DEFAULT_HTML_CACHE_CONTROL and withCacheHeaders**
Modify `DEFAULT_HTML_CACHE_CONTROL` to include `stale-while-revalidate` and update `withCacheHeaders` to accept and set the `Cache-Tag` header.

```typescript
const DEFAULT_HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400';

function withCacheHeaders(
	response: Response,
	cacheControl = DEFAULT_HTML_CACHE_CONTROL,
	tags?: string[]
): Response {
	const res = new Response(response.body, response);
	res.headers.set('Cache-Control', cacheControl);
	if (tags && tags.length > 0) {
		res.headers.set('Cache-Tag', tags.join(','));
	}
	return res;
}
```

- [ ] **Step 2: Update renderHomePage**
Tag homepage response with `list:home`.
```typescript
return withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, ['list:home']);
```

- [ ] **Step 3: Update renderSpeechesPage**
Tag speeches page response with `list:speeches` and use `DEFAULT_HTML_CACHE_CONTROL` instead of volatile header so that it can be cached on the edge and purged on-demand.
```typescript
response = withCacheHeaders(response, DEFAULT_HTML_CACHE_CONTROL, ['list:speeches']);
```

- [ ] **Step 4: Update renderSpeakersPage**
Tag speakers page response with `list:speakers`.
```typescript
response = withCacheHeaders(response, DEFAULT_HTML_CACHE_CONTROL, ['list:speakers']);
```

- [ ] **Step 5: Update renderPrivacyPage and renderTermsPage**
Tag privacy/terms page response with `list:privacy` and `list:terms`.
```typescript
return withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, ['list:privacy']);
```

- [ ] **Step 6: Update /speech/:section_id**
Query `filename` in database view `sections` and tag the response with `speech:${encodeURIComponent(section.filename)}`.
```typescript
const response = withCacheHeaders(c.html(html), DEFAULT_HTML_CACHE_CONTROL, [`speech:${encodeURIComponent(section.filename)}`]);
```

- [ ] **Step 7: Update /speaker/:route_pathname**
Tag speaker page response with `speaker:${encodeURIComponent(routePathname)}`.
```typescript
response = withCacheHeaders(response, DEFAULT_HTML_CACHE_CONTROL, [`speaker:${encodeURIComponent(routePathname)}`]);
```

- [ ] **Step 8: Update /:filename and /:filename/:nest_filename**
Tag speech page responses with `speech:${encodeURIComponent(filename)}`.
```typescript
response = withCacheHeaders(response, DEFAULT_HTML_CACHE_CONTROL, [`speech:${encodeURIComponent(filename)}`]);
```

---

### Task 3: Update OG Image and API Cache Headers

**Files:**
- Modify: `src/api/og_routes.ts`
- Modify: `src/api/an.ts`
- Modify: `src/api/md.ts`
- Modify: `src/api/rss.ts`

- [ ] **Step 1: Tag OG Images**
Update `src/api/og_routes.ts` to add `Cache-Tag: speech:${encodeURIComponent(filename)}` on generated OG images.
- In `handleOgSpeechImage`: tag with `speech:${encodeURIComponent(section.filename)}`.
- In `handleOgImage`: tag with `speech:${encodeURIComponent(filename)}`.

- [ ] **Step 2: Tag API .an responses**
- In `serveAnByKey` for single section: query `filename` from `sections` and tag with `speech:${encodeURIComponent(section.filename)}`.
- In `serveAnByKey` for full speech: tag with `speech:${encodeURIComponent(baseKey)}`.

- [ ] **Step 3: Tag API .md responses**
- In `serveMdByKey` for full speech: tag with `speech:${encodeURIComponent(baseKey)}`.
- For single section: set `Cache-Control: private, no-store` so they are not cached.

- [ ] **Step 4: Tag RSS feed**
- In `src/api/rss.ts` `rssFeed`: tag response with `list:rss` and use `FEED_CACHE_CONTROL`.

---

### Task 4: Integrate Purging on Markdown Uploads

**Files:**
- Modify: `src/api/upload_markdown.ts`

- [ ] **Step 1: Update invalidateSpeechCaches**
Call `purgeWorkersCache` with the speech tag and affected lists.
```typescript
	await purgeWorkersCache(c.executionCtx, {
		tags: [
			`speech:${encodeURIComponent(filename)}`,
			'list:home',
			'list:speeches',
			'list:rss'
		]
	});
```

- [ ] **Step 2: Update invalidateSpeakerCaches**
Call `purgeWorkersCache` with the affected speaker tags.
```typescript
	const tags = speakerRoutePathnames.map((p) => `speaker:${encodeURIComponent(p)}`);
	tags.push('list:speakers');
	await purgeWorkersCache(c.executionCtx, { tags });
```

- [ ] **Step 3: Update invalidateListPageCaches**
Call `purgeWorkersCache` with the chosen list tags.
```typescript
	const tags: string[] = [];
	if (home) tags.push('list:home');
	if (speeches) tags.push('list:speeches', 'list:rss');
	if (speakers) tags.push('list:speakers');
	if (tags.length > 0) {
		await purgeWorkersCache(c.executionCtx, { tags });
	}
```

---

### Task 5: Verification

- [ ] **Step 1: Verify type safety**
Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Verify test suite runs successfully**
Run: `bun run test`
Expected: PASS
