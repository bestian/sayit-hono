# Vue SSR on Cloudflare Workers

這個專案使用 Hono + Vue 3 在 Cloudflare Workers 上進行 SSR，沒有 App.vue、沒有 vue-router，每個頁面獨立維護於 `src/views`。

## 檔案結構
- `src/views/*.vue`：頁面來源，由 `vite-plugin-sfc-ssr.ts`（見 `vite.config.ts`）即時編譯成 SSR 元件，不需手動編譯步驟。
- `scripts/build-search-index.ts`：建置搜尋基線索引、manifest 與 `stats.json`，並同步到 R2（部署前需執行，見「部署」一節）。
- `src/index.ts`：Hono Worker 入口（middleware + route table），頁面 handler 在 `src/ssr/pages/`。

## 開發
```bash
bun install
bun run dev
```
本專案 package manager 統一用 **bun**（lockfile 為 `bun.lock`）；唯一例外是 `wrangler` 仍走 `npx wrangler …`，因為 bun runtime 已知會讓 `wrangler deploy` 在 async upload 完成前提早 exit。

`bun run dev` 啟動 `vite dev`（本地 workerd + 本地 D1/R2 持久化狀態，不連正式 Cloudflare 資源）。`.vue` 存檔即生效，不需要任何編譯指令。若要對照 staging 環境的真實資料，改用 `bun run dev:staging`。

## 清理快取(暫時)

1. 到dashboard。
2. 手動清理。

### 清理快取(未來)

1. 用TOKEN證明下指令者是管理員
2. 用API清理



## API 測試清單

- 取得演講目錄表 > `http://localhost:8787/api/speech_index.json`
- 取得講者列表 > `http://localhost:8787/api/speakers_index.json`
- 取得單一講者詳情 > `http://localhost:8787/api/speaker_detail/{route_pathname}.json`
	- `http://localhost:8787/api/speaker_detail/%E5%94%90%E9%B3%B3-3.json`
- 取得單一演講全文 > `http://localhost:8787/api/speech/{filename}`
    -  `http://localhost:8787/api/speech/2025-11-10-柏林自由會議ai-的角色`
- 取得指定段落詳情 > `http://localhost:8787/api/section/{section_id}`
    -   `http://localhost:8787/api/section/628198`
- 取得原始 .an 檔（支援 GET/HEAD）> `http://localhost:8787/api/an/{path}.an`
	-  `http://localhost:8787/api/an/2025-11-10-柏林自由會議ai-的角色.an`



## 靜態資源建置

靜態資源來源是 `public/`，`vite build` 會用 Vite 內建的 `publicDir` 機制原樣複製進 `dist/client/`，不需要任何手動同步指令。若要在 workerd 內近端預覽建置結果：
```bash
bun run preview
```
（`vite build && vite preview`，比純靜態伺服器更接近正式行為，因為是在真的 workerd 裡跑。）

### SSR 路由注意事項
- 所有頁面皆為 SSR 路由，並搭配 front Workers Cache（必要時以 R2 作 origin）。
- `.vue` 存檔即生效，不需要任何編譯步驟。

## 部署

**正式環境部署目前故意被封鎖**（`bun run deploy` / `deploy:assets` / `deploy:search` 都會印錯誤訊息並以非 0 結束）——`techdebt/vp-lemmascript-migration` 分支正在做大規模結構調整，尚未核准直接上正式站。所有部署先走 staging：

```bash
bun run deploy:staging          # 完整部署（含搜尋索引重建）
bun run deploy:staging:assets   # 略過搜尋索引重建（純前端/SSR 修改用）
```

兩者都會依序執行：`build:cache-version` → `CLOUDFLARE_ENV=staging vite build` → （`deploy:staging` 才有）`build:search`（`SEARCH_R2_BUCKETS` 已指向 staging bucket，不會動到正式索引）→ `wrangler deploy --env staging` → `verify:deploy`。**`CLOUDFLARE_ENV=staging` 必須在 `vite build` 之前設定**，`@cloudflare/vite-plugin` 在建置當下就決定要用哪個 named environment 的 binding，之後 `wrangler deploy --env staging` 不會覆寫已經烤進 `dist/` 的值。

### 搜尋索引建置（build:search）

```bash
bun run build:search
```

- **產出**：`scripts/build-search-index.ts` 會產生壓縮後的搜尋基線索引、即時 overlay manifest、以及首頁統計用的 `stats.json`，上傳到 `R2_BUCKETS`（可用 `SEARCH_R2_BUCKETS` 環境變數覆寫目標 bucket，預設是正式 bucket——本機單獨跑這個指令前請先確認要不要覆寫）。
- **特性**：建置腳本會保留本地快取供下次增量建置使用，並重新抓取變動過的 speeches，避免沿用過期 dump。
- 任何會對 R2 執行 `--remote` 寫入的腳本都經過 `scripts/lib/assert-not-prod.ts` 把關：目標 bucket 名稱不是以 `-staging`/`-preview` 結尾就預設拒絕，除非明確設 `ALLOW_PROD_R2=1`。



## 資料庫與儲存

### D1 資料庫

D1 資料庫用於儲存演講的索引資訊與講者資料，包含以下資料表：

#### `speech_index`
儲存演講檔案的基本索引資訊。

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | INTEGER | 主鍵 |
| filename | TEXT | 檔案名稱 |
| speakers | TEXT | 講者資訊 |

#### `speakers`
儲存講者的詳細資訊。

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | INTEGER | 主鍵 |
| name | TEXT | 講者名稱 |
| photoURL | TEXT | 講者照片 URL |
| speeches | INTEGER | 演講數量（預設 0） |
| longest_speech | INTEGER | 最長演講時長（預設 0） |

#### `speech_content`
儲存演講內容的分段資料。

| 欄位 | 類型 | 說明 |
|------|------|------|
| filename | TEXT | 檔案名稱 |
| section_id | INTEGER | 段落 ID（主鍵） |
| section_speaker | TEXT | 段落講者 |
| section_content | TEXT | 段落內容 |

初始化 SQL 檔案位於 `sql/` 目錄下：
- `sql/init-speech_index.sql`
- `sql/init-speakers.sql`
- `sql/init-speech_content.sql`


## GitHub Actions 整合

後端支援透過 GitHub Actions 進行自動化操作。需要以下認證：

- `Authorization: Bearer {token}` header
- `X-GitHub-Repository: {repo}` header

允許的儲存庫：
- `audreyt/transcript`
- `bestian/transcript`
