# Lanyang OG on archive.tw (license-safe)

## Constraint (justfont universal)

- Font **software** may live only on **licensed devices** (this Mac, dgx.local).
- **Never** commit OTF/WOFF, base64 `@font-face`, or ship font files in the Worker bundle / public repo.
- **PNG raster output** embeds glyph subsets only — permitted (same as PDF subset embedding).
- **Cloudflare Workers** are an **unlicensed third system**: do not run satori with Lanyang OTF there, do not store downloadable font binaries on R2 for runtime loading.

## Architecture

```
transcript push (.md)
  → sync-markdown (ubuntu) → archive.tw D1
  → rebuild-search-index (ubuntu) → wrangler deploy (new CACHE_KEY_VERSION)
  → bake-og-lanyang (self-hosted Mac) → wrangler r2 put PNG only
  → GET /og/{filename}.png → SPEECH_CACHE hit → bytes (no font code)
```

| Layer | Role |
|--------|------|
| **Licensed render farm** | `scripts/bake-og-lanyang.ts` + `og-lanyang-lib.ts` on Mac runner |
| **R2** | Key `${CACHE_KEY_VERSION}/og/${filename}.png` (same as `handleOgImage`) |
| **Worker** | Cache hit → serve PNG. Miss → existing Noto `generateOgImage` fallback |

## Transcript automation

Job `bake-og-lanyang` in `upload-markdown-on-change.yml`:

- `needs: rebuild-search-index` (D1 + deploy finished)
- `runs-on: self-hosted` (Mac with jf fonts + `wrangler` auth)
- Sets `CACHE_KEY_VERSION` from live `https://archive.tw/version` before bake (not committed `cacheKeyVersion.ts`)
- Re-runs `git diff` on transcript checkout for `before`/`after` SHAs
- Bakes only changed speeches

`scripts/bake-og-lanyang.ts` defaults to live `/version` when `CACHE_KEY_VERSION` is unset.

Register runner once on the Mac: [GitHub self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners).

## Local publish (transcript repo)

Git has **no** `post-push` hook. One-time: `cd transcript && bun run setup-hooks` (installs **pre-push** only — records `@{u}`..`HEAD` for root `*.md` in `.git/og-lanyang-push.json`).

**Normal flow:** `bun run push -- origin main` (= `git push` then `bake_lanyang_after_push.ts` polling `../sayit-hono` until `speech_index` has the new slug). Plain `git push` triggers GitHub Actions sync/deploy/self-hosted bake only; it does **not** run local bake.

- No jf fonts on this machine → bake scripts **noop** (exit 0); OG stays Noto until a licensed bake runs (CI self-hosted or another Mac).

**Deploy ordering:** Pushing `sayit-hono` alone does not bump live `/version` until transcript **rebuild-search-index** runs `bun run deploy`. If you `bun run push` transcript right after merging sayit-hono, local bake may upload under the **old** `CACHE_KEY_VERSION` while `speech_index` already has the new speech. Prefer: merge sayit-hono → push transcript (let Actions deploy) → confirm `https://archive.tw/version` → then `bun run push` for local bake; or skip local bake on that first push (`TRANSCRIPT_SKIP_LANYANG_OG=1`) and rely on **bake-og-lanyang** after deploy.

Skip local bake: `TRANSCRIPT_SKIP_LANYANG_OG=1 bun run push -- …`. Push **sayit-hono** `main` (cache-version helper + bake script) before relying on CI bake.

## Manual

```bash
cd sayit-hono
bun run scripts/bake-og-lanyang.ts --filename '2026-06-25-商周專欄-當-ai-模型像晶片一樣被管制'
bun run scripts/bake-og-lanyang.ts --git <before> <after> --transcript-root ~/w/transcript
```

## Not in scope (by license)

- Subsetting OTF to WOFF2 and uploading font files to R2 for Worker-side satori
- Bundling font bytes in the Worker
- GitHub-hosted `ubuntu-latest` bake (no licensed fonts)