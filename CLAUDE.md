# CLAUDE.md

本檔案提供給 Claude Code (claude.ai/code) 在此 repository 中工作時的指引。

## 開發工作流程規則

### Issue 與 Commit 連動規則

在每一筆更新 commit 之前，必須遵守以下流程：

1. **先開立對應的 Issue**：在進行任何程式碼變更之前，先在 GitHub 上開立一個對應的 Issue，並在 Issue 內容中清楚說明：
   - 這筆更新的主要範圍（scope）
   - 這筆更新要解決的問題（problem / motivation）

2. **Commit 時關閉 Issue**：在 commit message 中使用 GitHub 的關鍵字（例如 `Closes #<issue-number>`、`Fixes #<issue-number>` 或 `Resolves #<issue-number>`），讓該 commit 在被合併時自動關閉對應的 Issue。

範例 commit message：

```
新增使用者登入功能

實作 OAuth2 登入流程，支援 Google 與 GitHub 兩種第三方登入方式。

Closes #42
```

此規則適用於所有功能新增、bug 修正、refactor 與文件更新。

## 專案概述

**SayIt-Hono** 是一個架在 Cloudflare Workers 上的 Vue 3 SSR 網站，用 Hono 作為路由框架，提供 SayIt 演講 / 講者 / 段落內容的動態渲染、搜尋與 RSS。

核心特性：

- **無 SPA / 無 vue-router**：每個頁面是獨立的 `.vue` 檔，由 Hono 直接 SSR 渲染。
- **Workers Cache + optional R2 origin**：公開 GET 靠 front Workers Cache（`Cache-Control` / `Cache-Tag`）；昂貴 SSR HTML 與 `an`/`md`/OG 另寫 R2 origin。內容變更用 tag purge；R2 部署失效靠 `CACHE_KEY_VERSION`。

- **Static-first**：靜態資源（`www/`）優先由 ASSETS binding 服務，找不到才走 SSR / API。
- **D1 為資料來源**：所有演講、段落、講者資料都存在 D1，搜尋索引會額外烤成 JSON 放在 R2。

## 技術棧

| 類別          | 技術                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime       | Cloudflare Workers（`compatibility_date` 設於 `wrangler.jsonc`）                                                                                                                        |
| 路由框架      | [Hono](https://hono.dev) v4                                                                                                                                                             |
| UI / 模板     | Vue 3 SFC + `@vue/server-renderer`（SSR only）                                                                                                                                          |
| 構建工具      | [Vite](https://vite.dev) + `@cloudflare/vite-plugin`（`vp` / Vite+ 相容棧）+ 自寫 `vite-plugin-sfc-ssr.ts`（`.vue` → SSR render function，即時編譯，取代舊的 `scripts/build-views.ts`） |
| 部署工具      | Wrangler 4（由 Vite 驅動建置，`vp`/Vite+ 相容）                                                                                                                                         |
| 資料庫        | Cloudflare D1（binding：`DB`）                                                                                                                                                          |
| 物件儲存      | Cloudflare R2（binding：`SPEECH_CACHE`）                                                                                                                                                |
| 靜態資源      | Cloudflare Workers Assets（binding：`ASSETS`，來源 `public/`，由 Vite `publicDir` 機制建置）                                                                                            |
| 搜尋          | 自製基線索引 + overlay manifest（R2）+ `fuse.js`                                                                                                                                        |
| OG 圖片       | `satori` + `@resvg/resvg-wasm`                                                                                                                                                          |
| Markdown      | `marked`、`cheerio`                                                                                                                                                                     |
| 測試          | Vitest + `@cloudflare/vitest-pool-workers`、`@vitest/coverage-istanbul`                                                                                                                 |
| Lint / Format | `oxlint` + `oxfmt`（Oxc 工具鏈，`bun run check`）                                                                                                                                       |
| 形式驗證      | [LemmaScript](https://github.com/midspiral/lemmascript)（`lsc`）：部分 `src/utils/*` 純函式標註 `//@ ensures` 等，`bun run verify:lsc` 檢查（見下方「形式驗證」一節）                   |
| 語言          | TypeScript（嚴格模式，`tsgo --noEmit` 把關）                                                                                                                                            |

## 目錄結構

```
src/
├── index.ts             # Hono Worker 入口：middleware、route table，呼叫 ssr/pages 與 api 模組
├── api/                 # JSON / 資源 API（speech_index、speakers、og、rss、upload_markdown 等）
├── components/          # 共用 Vue 元件（Navbar、Footer 等）
├── views/                # 各頁面的 Vue SFC（HomeView、SingleSpeechView、SearchResultView…）
├── ssr/
│   ├── render.ts        # 包裝 createSSRApp + renderToString，輸出完整 HTML
│   ├── heads.ts         # 每個頁面的 <head> meta / OG / canonical 規格
│   └── pages/           # SSR 頁面 handler（home/search/speech/speaker + shared），由 index.ts 註冊路由後呼叫
├── search/              # 搜尋索引格式、runtime 比對、文件建立
├── utils/                # 純工具：分頁、區段標準化、講者顏色、文字處理（textUtils）、段落 LCS/patch（sectionPatch）、快取失效計畫（cachePlan）
├── vue-shim.d.ts         # `*.vue` 環境型別宣告，供 tsgo 使用
└── cacheKeyVersion.ts    # 由 build:cache-version 產生，控制快取失效
vite.config.ts             # Vite + @cloudflare/vite-plugin + 自寫 sfcSsrPlugin 設定
vite-plugin-sfc-ssr.ts     # `.vue` → SSR render function 即時編譯 plugin
scripts/                   # tsx/node 腳本：build-search-index、generate-cache-version、preflight/verify-deploy、verify-lsc 等
sql/                       # D1 schema 與 view（init-*.sql、view_*.sql）
test/                      # Vitest 測試（*.spec.ts，跑在 workers pool 裡）；test/helpers/ 放共用 mock env
public/                    # 靜態資源來源（Vite publicDir，建置時複製進 dist/client/）
data/、files/、raw_*       # 演講原始資料與輸入輸出範本
```

## 開發工作流程

### 安裝與啟動

```bash
bun install
bun run dev         # = vite dev（本地 workerd + 本地 D1/R2 持久化狀態，不連正式環境）
```

> 本專案的 package manager 統一用 **bun**（lockfile 為 `bun.lock`）。
> 唯一例外：`wrangler` 仍走 `npx wrangler …`，因為 bun runtime 有
> 已知 bug 會讓 wrangler deploy 在 async upload 完成前提早 exit。

`vite dev`（`@cloudflare/vite-plugin`）在本機 workerd 執行，預設用本地持久化的 D1/R2 狀態，**不會**連到正式 Cloudflare 資源；需要對照正式資料時才用 `bun run dev:staging`（見下方 staging 一節）。`.vue` 由 `vite-plugin-sfc-ssr.ts` 即時編譯，不需任何手動編譯步驟——存檔即生效。

### 常用指令

| 指令                                            | 說明                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`                                   | 開發伺服器（`vite dev`，本地 workerd + 本地 D1/R2）                                                                                       |
| `bun run dev:staging`                           | 開發伺服器，連到 staging 環境（`CLOUDFLARE_ENV=staging vite dev`）                                                                        |
| `bun run build`                                 | 建置正式 Worker bundle（`vite build`，輸出到 `dist/`）                                                                                    |
| `bun run preview`                               | 建置後用 `vite preview` 在 workerd 內預覽（比純靜態伺服器更接近正式行為）                                                                 |
| `bun run build:search`                          | 重建搜尋基線索引、overlay manifest、`stats.json`，並上傳 R2（`SEARCH_R2_BUCKETS` 可覆寫目標 bucket）                                      |
| `bun run build:cache-version`                   | 重新產生 `src/cacheKeyVersion.ts`，做為快取 key 前綴                                                                                      |
| `bun run check`                                 | `lint` + `fmt:check` + `typecheck` 一次跑完                                                                                               |
| `bun run lint` / `fmt` / `fmt:check`            | `oxlint` / `oxfmt --write` / `oxfmt --check`                                                                                              |
| `bun run test` / `test:watch` / `test:coverage` | Vitest 測試（含覆蓋率）                                                                                                                   |
| `bun run typecheck`                             | `tsgo --noEmit` 全專案型別檢查                                                                                                            |
| `bun run verify:lsc`                            | 對已標註 LemmaScript `//@` 的 `src/utils/*` 純函式跑 `lsc gen` + `lsc check --backend=dafny`，比對已知 verified/error 基準，抓 regression |
| `bun run cf-typegen`                            | 由 `wrangler.jsonc` 產生 `worker-configuration.d.ts`                                                                                      |

### 部署

正式環境部署（`bun run deploy` / `deploy:assets` / `deploy:search`）目前**故意被封鎖**，因為 `techdebt/vp-lemmascript-migration` 分支正在進行大規模結構調整，尚未經過人工核准直接上正式站。所有部署動作先走 staging：

| 指令                            | 說明                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run deploy:staging`        | 完整 staging 部署：`build:cache-version` → `CLOUDFLARE_ENV=staging vite build` → `SEARCH_R2_BUCKETS=sayit-speech-cache-staging build:search` → `wrangler deploy --env staging` → `verify:deploy` |
| `bun run deploy:staging:assets` | 略過搜尋索引重建的 staging 部署（純前端 / SSR 修改用）                                                                                                                                           |

**`CLOUDFLARE_ENV=staging` 必須在 `vite build` 之前設定**——`@cloudflare/vite-plugin` 在建置時就決定要用 `wrangler.jsonc` 的哪個 named environment（`env.staging` 的 D1/R2 binding），之後才執行 `wrangler deploy --env staging` 的話，`--env` 旗標**不會**覆寫已經烤進 `dist/` 的 binding——這點已用 `wrangler deploy --dry-run` 實測驗證過。

`env.staging`（`wrangler.jsonc`）是完全獨立宣告的 binding 集合（named environment **不會**繼承頂層 binding）：`sayit-database-staging`（D1）、`sayit-speech-cache-staging`（R2）、`sayit-hono-staging`（Worker 名稱）。

`scripts/lib/assert-not-prod.ts` 是任何會對 R2 執行 `--remote` 寫入的腳本（`build-search-index.ts`、`warm-cache.ts`、`bake-og-lanyang.ts`）共用的安全閘門：目標 bucket 名稱若不是以 `-staging` / `-preview`結尾，預設直接拒絕，除非明確設定 `ALLOW_PROD_R2=1`。

## 路由與快取設計

`src/index.ts` 的執行順序（從上而下）：

1. **`canonicalHtmlPageMiddleware`**：把 `/index.html`、`/speeches`、`/speakers`、`/search` 等路徑 302 導到正規版本（含尾斜線）；對講者頁的 `?page=` 也做標準化。新增路由時要評估是否需要納入此 middleware。
2. **`staticFirstMiddleware`**：嘗試從 `ASSETS` 取靜態檔；除非路徑屬於明確的 SSR / API 區塊（`/api/*`、`/og/*`、`/speech/*`、`/speaker/*`、`/search-updates/*`、`/search-index*.json`、`/sections-dump.json`、`/stats.json`、`/`、`/speeches/`、`/speakers/`），找到就直接回應。
3. **API 路由**（`/api/...`、`/search/`、`/og/...`、`/rss.xml` 等）。
4. **SSR 路由**（首頁、列表頁、演講頁、巢狀演講頁、講者頁、單段落頁）。
5. **`.md` / `.an` 檔的轉換路由**（兩段：`/:path{[^/]+\.md}`、`/:path{[^/]+\.an}` 以及 `/speech/...`）。
6. **catch-all `app.get('*', …)`** 回 404。

快取層級（Workers Cache first）：

- **Front Workers Cache**（`wrangler.jsonc` `cache.enabled: true`）：公開 GET 依 `Cache-Control` / `Cache-Tag` 在 Worker 前命中。平台 key = path+query（+ entrypoint + Worker version），**不含 host**。內容變更用 `purgeWorkersCache({ tags, pathPrefixes? })`（`import { cache } from 'cloudflare:workers'`）。`pathPrefixes` 是真前綴——**不要**用 `'/'` 當「只清首頁」；列表根路徑靠 `list:*` tags。
- **R2 origin**（`SPEECH_CACHE`，`readR2Cache` / `writeR2Cache`）：昂貴 SSR HTML（演講/講者/列表）與衍生產物（`an/<filename>`、`md/<filename>`、versioned OG）。HTML key：`${CACHE_KEY_VERSION}/${host}${path}`；`an`/`md` 穩定不帶版本。讀回時會還原 `Cache-Tag`（customMetadata）再交給 front cache。
- **不再使用** in-Worker `caches.default`（`readEdgeCache` / `writeEdgeCache` 已移除）。
- **`/api/purge_cache`**：清空 R2 後 `purgeWorkersCache({ purgeEverything: true })`。**`/api/cleanup_old_cache`**：只刪非目前 `CACHE_KEY_VERSION/` 的 R2 前綴，不清 front。兩者受 Bearer token 保護（`AUDREYT_TRANSCRIPT_TOKEN` / `BESTIAN_TRANSCRIPT_TOKEN`）。

## 框架使用注意事項

### Hono / Workers

- Worker 入口由 `src/index.ts` 的 `export default app;` 提供。
- Bindings 的型別來自 `src/api/types.ts` 的 `ApiEnv`；新增 binding 要同時更新 `wrangler.jsonc` 與該型別。
- satori 需要 `process` / `process.env` polyfill；由 `vite.config.ts` 的 `define` 提供（Vite 建置後 wrangler.jsonc 的 `define` 欄位會被忽略）。不要在執行期依賴 `process.env`，請改用 `c.env.<BINDING>` 或 secrets。
- 任何長時間運算請拆成 stream / 分頁查詢；Worker 有 CPU time 限制。

### Vue 3 SSR

- **沒有 vue-router、沒有 App.vue、沒有 client-side hydration**。`renderHtml()` 只跑 `renderToString`，HTML 出來就是最終樣子。
- 每個頁面 = `src/views/<Name>View.vue`；共用元件放 `src/components/`。
- `.vue` 由 `vite-plugin-sfc-ssr.ts`（見 `vite.config.ts`）在 `vite dev` / `vite build` / `vitest` 三個路徑即時編譯成 SSR render function，**不需要任何手動編譯步驟**——直接 `import X from './views/X.vue'` 即可，Vite 處理其餘部分。舊的 `bun run build:views` / `src/.generated/` 兩段式流程已移除。
- 每個編譯後的元件額外 export 一個 `styles` 字串常數（編譯好的 CSS），因為本專案沒有瀏覽器端資源管線可以掛載 `<link>` 樣式表——`renderHtml()` 把它直接 inline 進回應 HTML 的 `<style>` 標籤。`*.vue` 的環境型別宣告在 `src/vue-shim.d.ts`。
- 樣式以 `<style scoped>` 為主，scopeId 為 `${檔名}-ssr`（與舊版一致，見 `vite-plugin-sfc-ssr.ts` 檔頭註解）。

### D1 / SQL

- Schema 與 view 定義在 `sql/` 下的 `init-*.sql`、`view_*.sql`、`add-*.sql`。
- 主要表：`speech_index`（演講中繼）、`speech_content`（段落內容）、`speakers`（講者）、加上 view `speakers_view`、`view_sections`。講者詳情 runtime 走 `src/db/speaker-detail.ts`（indexed per-speaker），不查 `speakers_view`。
- 查詢全部走 `c.env.DB.prepare(...).bind(...).first() / .all()`，請務必檢查 `result.success` 並丟出錯誤，避免回 200 但內容空白。

### R2 / 搜尋

- 搜尋索引 key 常數集中在 `src/search/indexFormat.ts`（`SEARCH_INDEX_BASELINE_KEY`、`SEARCH_INDEX_BASELINE_BR_KEY`、`SEARCH_INDEX_MANIFEST_KEY`、`SEARCH_UPDATES_PREFIX`、`SEARCH_STATS_KEY`）。
- 寫入流程在 `scripts/build-search-index.ts`，包含 brotli 壓縮版本與 manifest；新增搜尋欄位時要同步調整 `src/search/docBuilder.ts` 與 runtime 比對邏輯。

### 測試

- 測試位於 `test/*.spec.ts`，由 `@cloudflare/vitest-pool-workers` 在 Workers 環境執行。實務上每個測試手動建構 `MockWorkerEnv`（見 `test/helpers/mockEnv.ts` 的 `createMockEnv(resolver, options?)` + `dispatch(path, env, init?)`）而非直接用 pool-workers 的 miniflare binding；bespoke SQL 比對邏輯留在各別 spec 檔，只有 D1/R2/ASSETS mock 外殼與 dispatch 樣板抽到共用 helper。純函式測試（`src/utils/*` 等無 Worker dispatch 者）不需要這個 helper，直接呼叫函式即可。
- 設定檔：`vitest.config.mts` / `wrangler.vitest.jsonc` / `test/tsconfig.json`。
- 所有四項指標（statement、branch、function、line）都透過 `vitest.config.mts` 的 `coverage.thresholds` 強制要求每支檔案達到 100% 覆蓋率（`perFile: true`），這是透過真實測試達成的，而非放寬任何門檻。新功能必須補測，不要降低覆蓋率門檻；也不要為了湊 100% 硬塞型別系統不允許的輸入（例如 `as any` 繞過型別去測不可達分支）——這類測試會被視為 coverage theater，應該移除或改測真正可達的情境。
- 跑單一測試：`npx vitest run test/<name>.spec.ts`。

### 形式驗證（LemmaScript）

- `src/utils/sectionUtils.ts`、`pagination.ts`、`speakerColor.ts`、`sectionPatch.ts` 的部分純函式標註了 `//@ requires` / `//@ ensures` / `//@ invariant` / `//@ decreases` / `//@ extern` 註解（見各檔案內的說明性註解），`bun run verify:lsc`（`scripts/verify-lsc.mjs`）跑 `lsc gen` + `lsc check --backend=dafny` 並比對記錄在該腳本 `BASELINE` 常數裡的 verified/error 基準，抓 regression（不要求全部歸零——多個檔案受限於 lsc 目前無法處理 TypeScript 泛型、`Map`、union type 等結構，會誠實停在有限的 verified 數字，這是已知、有記錄的落差，不是待修的 bug）。
- 標註 `//@ extern` 的函式（例如 `sectionPatch.ts` 全部函式）代表 lsc 把它們的 body 當公理接受、`ensures` 是**信任的契約而非機器驗證的證明**——讀輸出時不要把這類「N verified」誤讀為對真實實作的證明。
- 新增/修改被標註的函式時，先跑 `bun run verify:lsc`；若某函式無法被 lsc 建模（RegExp、JSON.parse、任意 I/O 等），在函式上方加一行 `// not lsc-verifiable: <原因>` 註解，不要硬套。

### TypeScript / 型別

- 全專案 `bun run typecheck`（`tsgo --noEmit`）必須通過。
- 修改 `wrangler.jsonc` 後執行 `bun run cf-typegen` 重新產生 `worker-configuration.d.ts`。
- `*.vue` 型別宣告在 `src/vue-shim.d.ts`；不要為個別元件加型別宣告，那是共用 ambient 宣告。

## 風格與慣例

- TypeScript 嚴格模式，函式優先小而純；DB 查詢與 SSR 邏輯分離（DB → 純資料 → render）。
- 中文註解 / commit message 為主，但 identifiers / API 維持英文。
- `src/index.ts` 只放 middleware、route table、與少數真正屬於 worker 入口層級的 helper；頁面 handler 抽到 `src/ssr/pages/`，JSON API 抽到 `src/api/`，純工具抽到 `src/utils/` 對應模組。
- 新增頁面流程：在 `src/views/` 建 SFC → `src/ssr/heads.ts` 增 head spec → 在 `src/ssr/pages/` 對應檔案加 render function → `src/index.ts` 註冊路由 → 寫測試（存檔即生效，不需要編譯步驟）。
- `bun run check`（lint + format check + typecheck）在改動 `src/`、`scripts/` 後應該保持綠燈；CI（`.github/workflows/ci.yml`）會擋。

## 部署資源備忘

**正式環境：**

- 生產 D1：`sayit-database`（id 在 `wrangler.jsonc` 頂層）。
- R2 bucket：`sayit-speech-cache`（preview：`sayit-speech-cache-preview`）。
- ASSETS 來源：`./public/`（`vite build` 建置時複製進 `dist/client/`，供 `wrangler deploy` 使用）。
- Worker 名稱：`sayit-hono`。

**Staging 環境（`wrangler.jsonc` `env.staging`，完全獨立宣告，不繼承頂層 binding）：**

- D1：`sayit-database-staging`。
- R2 bucket：`sayit-speech-cache-staging`。
- Worker 名稱：`sayit-hono-staging`。
- 資料庫已用 repo 自帶的 `sql/init-*.sql` + `sql/fill-*.sql` + `sql/view_*.sql` 灌好種子資料：`speech_index`／`speakers` 是完整 metadata（2000+ 演講、8000+ 講者，來自 `raw_sample_data/` 一次性 scrape），但 `speech_content`（段落全文）只灌了 `sql/speech/*.sql` 這兩篇範例（`1999年全國司法改革會議`、`2025-11-10-柏林自由會議ai-的角色`）——其餘演講在 staging 上會 404（`speech_content` 查無資料是 renderSpeechPage 的正常回應，不是 bug）。測試 SSR 演講頁／PATCH upload_markdown 請用這兩篇之一，或先自己 POST 一篇。不需要對正式 D1 做任何讀寫即可重建。
- upload_markdown 需要的 `AUDREYT_TRANSCRIPT_TOKEN`／`BESTIAN_TRANSCRIPT_TOKEN` secrets 預設不會隨部署建立（`wrangler secret list --env staging` 初始是空的）；要測 staging 上的認證寫入路徑，先 `echo <token> | npx wrangler secret put AUDREYT_TRANSCRIPT_TOKEN --env staging` 補一個（僅此環境，正式環境的 secret 另外管理，不要沿用同一組）。

- 觀測：`observability.enabled = true`，請善用 Cloudflare Logs。

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
