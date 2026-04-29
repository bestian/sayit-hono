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
- **Edge + R2 雙層快取**：HTML 響應同時寫入 Cloudflare Edge Cache 與 R2，重新部署時透過 `CACHE_KEY_VERSION` 自動失效。
- **Static-first**：靜態資源（`www/`）優先由 ASSETS binding 服務，找不到才走 SSR / API。
- **D1 為資料來源**：所有演講、段落、講者資料都存在 D1，搜尋索引會額外烤成 JSON 放在 R2。

## 技術棧

| 類別 | 技術 |
|------|------|
| Runtime | Cloudflare Workers（`compatibility_date` 設於 `wrangler.jsonc`） |
| 路由框架 | [Hono](https://hono.dev) v4 |
| UI / 模板 | Vue 3 SFC + `@vue/server-renderer`（SSR only） |
| 構建工具 | `tsx`、`@vue/compiler-sfc`（自寫的 `scripts/build-views.ts`） |
| 部署工具 | Wrangler 4 |
| 資料庫 | Cloudflare D1（binding：`DB`） |
| 物件儲存 | Cloudflare R2（binding：`SPEECH_CACHE`） |
| 靜態資源 | Cloudflare Workers Assets（binding：`ASSETS`） |
| 搜尋 | 自製基線索引 + overlay manifest（R2）+ `fuse.js`、Pagefind |
| OG 圖片 | `satori` + `@resvg/resvg-wasm` |
| Markdown | `marked`、`cheerio` |
| 測試 | Vitest + `@cloudflare/vitest-pool-workers`、`@vitest/coverage-istanbul` |
| 語言 | TypeScript（嚴格模式，`tsc --noEmit` 把關） |

## 目錄結構

```
src/
├── index.ts             # Hono Worker 入口，所有路由與 middleware 都在這裡
├── api/                 # JSON / 資源 API（speech_index、speakers、og、rss、upload_markdown 等）
├── components/          # 共用 Vue 元件（Navbar、Footer 等）
├── views/               # 各頁面的 Vue SFC（HomeView、SingleSpeechView、SearchResultView…）
├── ssr/
│   ├── render.ts        # 包裝 createSSRApp + renderToString，輸出完整 HTML
│   └── heads.ts         # 每個頁面的 <head> meta / OG / canonical 規格
├── search/              # 搜尋索引格式、runtime 比對、文件建立
├── utils/               # 純工具：分頁、區段標準化、講者顏色等
├── cacheKeyVersion.ts   # 由 build:cache-version 產生，控制快取失效
└── .generated/          # build:views 產出的 SSR 元件，**請勿手動編輯，也不要 commit 修改**
scripts/                 # tsx 腳本：build-views、build-assets、build-search-index、generate-cache-version
sql/                     # D1 schema 與 view（init-*.sql、view_*.sql）
test/                    # Vitest 測試（*.spec.ts，跑在 workers pool 裡）
public/                  # 原始靜態資源
www/                     # build:assets 產出，給 ASSETS binding
data/、files/、raw_*     # 演講原始資料與輸入輸出範本
```

## 開發工作流程

### 安裝與啟動

```bash
npm install
npm run dev         # = build:views + wrangler dev --remote
```

`wrangler dev --remote` 會連到實際的 Cloudflare 資源（D1、R2），所以本地也能存取真實資料。修改 `.vue` 後必須重新跑 `npm run build:views`（或 `npm run dev`）讓 `src/.generated/` 更新。

### 常用指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 開發伺服器（編譯 views + wrangler dev --remote） |
| `npm run build:views` | 將 `src/views`、`src/components` 的 `.vue` 編譯到 `src/.generated/` |
| `npm run build:assets` | 把 `public/` 同步到 `www/` |
| `npm run build:search` | 重建搜尋基線索引、overlay manifest、`stats.json`，並上傳 R2 |
| `npm run build:cache-version` | 重新產生 `src/cacheKeyVersion.ts`，做為快取 key 前綴 |
| `npm run deploy` | 完整部署（cache version + views + assets + search + wrangler deploy） |
| `npm run deploy:assets` | 不重建搜尋索引的部署（純前端 / 視圖修改用） |
| `npm run preview:assets` | 用 `python3 -m http.server` 預覽 `www/` |
| `npm run test` / `test:watch` / `test:coverage` | Vitest 測試（含覆蓋率） |
| `npm run typecheck` | `tsc --noEmit` 全專案型別檢查 |
| `npm run cf-typegen` | 由 `wrangler.jsonc` 產生 `worker-configuration.d.ts` |

### 部署前必跑

`npm run deploy` 已串好下列流程，自寫 CI 時請依序執行：

1. `build:cache-version`（產生 `cacheKeyVersion.ts`，使舊 R2/Edge cache 自動作廢）
2. `build:views`（編譯 SFC 到 `src/.generated/`）
3. `build:assets`（同步 `public/` → `www/`）
4. `build:search`（產出基線索引與 `stats.json`，並上傳到 R2）
5. `wrangler deploy`

## 路由與快取設計

`src/index.ts` 的執行順序（從上而下）：

1. **`canonicalHtmlPageMiddleware`**：把 `/index.html`、`/speeches`、`/speakers`、`/search` 等路徑 302 導到正規版本（含尾斜線）；對講者頁的 `?page=` 也做標準化。新增路由時要評估是否需要納入此 middleware。
2. **`staticFirstMiddleware`**：嘗試從 `ASSETS` 取靜態檔；除非路徑屬於明確的 SSR / API 區塊（`/api/*`、`/og/*`、`/speech/*`、`/speaker/*`、`/search-updates/*`、`/search-index*.json`、`/sections-dump.json`、`/stats.json`、`/`、`/speeches/`、`/speakers/`），找到就直接回應。
3. **API 路由**（`/api/...`、`/search/`、`/og/...`、`/rss.xml` 等）。
4. **SSR 路由**（首頁、列表頁、演講頁、巢狀演講頁、講者頁、單段落頁）。
5. **`.md` / `.an` 檔的轉換路由**（兩段：`/:path{[^/]+\.md}`、`/:path{[^/]+\.an}` 以及 `/speech/...`）。
6. **catch-all `app.get('*', …)`** 回 404。

快取層級：

- **Edge Cache**（`api/cache.ts` 的 `readEdgeCache` / `writeEdgeCache`）：HTML / API JSON 響應使用，key 為 `${CACHE_KEY_VERSION}/${host}${pathname}[?search]`。
- **R2 Cache**（`SPEECH_CACHE`，`readR2Cache` / `writeR2Cache`）：較長壽的 SSR 頁面（演講頁、講者頁、巢狀頁）會寫入 R2，部署後依 `CACHE_KEY_VERSION` 失效，搭配 `/api/purge_cache`、`/api/cleanup_old_cache` 維護。
- **`/api/purge_cache` 與 `/api/cleanup_old_cache`** 受 Bearer token 保護，secrets 為 `AUDREYT_TRANSCRIPT_TOKEN` / `BESTIAN_TRANSCRIPT_TOKEN`。

## 框架使用注意事項

### Hono / Workers

- Worker 入口由 `src/index.ts` 的 `export default app;` 提供。
- Bindings 的型別來自 `src/api/types.ts` 的 `ApiEnv`；新增 binding 要同時更新 `wrangler.jsonc` 與該型別。
- `wrangler.jsonc` 對 `process.env` 做了 `define` polyfill 以相容 `satori`；不要在執行期依賴 `process.env`，請改用 `c.env.<BINDING>` 或 secrets。
- 任何長時間運算請拆成 stream / 分頁查詢；Worker 有 CPU time 限制。

### Vue 3 SSR

- **沒有 vue-router、沒有 App.vue、沒有 client-side hydration**。`renderHtml()` 只跑 `renderToString`，HTML 出來就是最終樣子。
- 每個頁面 = `src/views/<Name>View.vue`；共用元件放 `src/components/`。
- `.vue` 不會被 Worker 直接 import；必須先 `npm run build:views` 編譯到 `src/.generated/`。`src/index.ts` 是從 `./.generated/views/...` import 的。
- 編譯產物加了 `// @ts-nocheck`，`src/.generated/` 不要手動編輯，也不要把它的修改 commit 上去（已在 `tsconfig.json` / `.gitignore` 控制）。
- 樣式以 `<style scoped>` 為主，`scripts/build-views.ts` 會處理 scoped 編譯並輸出 `styles` 字串供 `renderHtml` 注入。

### D1 / SQL

- Schema 與 view 定義在 `sql/` 下的 `init-*.sql`、`view_*.sql`、`add-*.sql`。
- 主要表：`speech_index`（演講中繼）、`speech_content`（段落內容）、`speakers`（講者）、加上 view `speakers_view`、`view_sections`。
- 查詢全部走 `c.env.DB.prepare(...).bind(...).first() / .all()`，請務必檢查 `result.success` 並丟出錯誤，避免回 200 但內容空白。

### R2 / 搜尋

- 搜尋索引 key 常數集中在 `src/search/indexFormat.ts`（`SEARCH_INDEX_BASELINE_KEY`、`SEARCH_INDEX_BASELINE_BR_KEY`、`SEARCH_INDEX_MANIFEST_KEY`、`SEARCH_UPDATES_PREFIX`、`SEARCH_STATS_KEY`）。
- 寫入流程在 `scripts/build-search-index.ts`，包含 brotli 壓縮版本與 manifest；新增搜尋欄位時要同步調整 `src/search/docBuilder.ts` 與 runtime 比對邏輯。

### 測試

- 測試位於 `test/*.spec.ts`，由 `@cloudflare/vitest-pool-workers` 在 Workers 環境執行，可直接用 `c.env.DB`、`c.env.SPEECH_CACHE`、`c.env.ASSETS`。
- 設定檔：`vitest.config.mts` / `wrangler.vitest.jsonc` / `test/tsconfig.json`。
- 期望 100% statement / line / function coverage（請參考歷史 commit `Enforce statement coverage`）；新功能必須補測，不要降低覆蓋率門檻。
- 跑單一測試：`npx vitest run test/<name>.spec.ts`。

### TypeScript / 型別

- 全專案 `tsc --noEmit` 必須通過。
- 修改 `wrangler.jsonc` 後執行 `npm run cf-typegen` 重新產生 `worker-configuration.d.ts`。
- 不要在 `src/.generated/` 內加型別宣告；那是輸出目錄。

## 風格與慣例

- TypeScript 嚴格模式，函式優先小而純；DB 查詢與 SSR 邏輯分離（DB → 純資料 → render）。
- 中文註解 / commit message 為主，但 identifiers / API 維持英文。
- 不要在 `src/index.ts` 大幅膨脹，可抽到 `src/api/`、`src/utils/`、`src/ssr/` 對應模組。
- 新增頁面流程：在 `src/views/` 建 SFC → `src/ssr/heads.ts` 增 head spec → `src/index.ts` 註冊路由 → 跑 `build:views` → 寫測試。

## 部署資源備忘

- 生產 D1：`sayit-database`（id 在 `wrangler.jsonc`）。
- R2 bucket：`sayit-speech-cache`（preview：`sayit-speech-cache-preview`）。
- ASSETS 目錄：`./www/`。
- 觀測：`observability.enabled = true`，請善用 Cloudflare Logs。
