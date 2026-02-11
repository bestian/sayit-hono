# Vue SSR on Cloudflare Workers

這個專案使用 Hono + Vue 3 在 Cloudflare Workers 上進行 SSR，沒有 App.vue、沒有 vue-router，每個頁面獨立維護於 `src/views`。

## 檔案結構
- `src/views/*.vue`：頁面來源。
- `scripts/build-views.ts`：將 `.vue` 轉成 Worker 可用的 SSR 元件，輸出到 `src/.generated/views`。
- `scripts/build-assets.ts`：將 `public/` 靜態資源複製到 `www/`（給 ASSETS 使用）。
- `src/index.ts`：Hono Worker，直接渲染各頁。

## 開發
```bash
npm install
npm run dev
```
`npm run dev` 會先把 `.vue` 編譯到 `src/.generated/views`，再啟動 `wrangler dev`。修改 `.vue` 後需重跑一次 `npm run dev` 或單獨執行 `npm run build:views` 讓編譯檔更新。

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
```bash
npm run build:assets
```
會把 `public/` 同步到 `www/`。若要近端預覽靜態檔：
```bash
npm run preview:assets
```
（等同 `python3 -m http.server 4173 -d www`）

### SSR 路由注意事項
- 所有頁面皆為 SSR 路由，並搭配 R2/Edge 快取。
- 部署或開發前，仍需先執行 `npm run build:views` 生成 `src/.generated/views` 供 Worker 匯入。

## 部署
```bash
npm run deploy
```
會先編譯視圖再交給 `wrangler deploy`。ASSETS 來源為 `www/`（由 `build:assets` 產生）。

### 先建置資源再部署 Worker（ASSETS）
若要在遠端或本地先跑完 `build:assets` 後，再像 `npm run deploy` 一樣更新 Worker 與 ASSETS：
```bash
npm run deploy:assets
```
等同 `npm run build:assets && wrangler deploy`：先產出 `www/`，再一併上傳 Worker 與靜態資源。CI 上可依序執行 `build:assets` 與 `wrangler deploy` 達到相同效果。



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

