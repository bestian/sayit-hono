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

## Local `git push` (transcript repo)

One-time: `cd transcript && bun run setup-hooks` (chains `.githooks/pre-push-lanyang` + `post-push-lanyang`).

On push of root `*.md`: pre-push records `@{u}`..`HEAD`; GitHub Actions sync/deploy/bake; post-push runs `bake_lanyang_after_push.ts` against `../sayit-hono` with retries until `speech_index` has the new slug.

Skip local bake: `TRANSCRIPT_SKIP_LANYANG_OG=1 git push`. Push **sayit-hono** `main` (cache-version helper + bake script) before relying on CI bake.

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