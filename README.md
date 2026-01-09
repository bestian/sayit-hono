# Vue SSR on Cloudflare Workers

這個專案使用 Hono + Vue 3 在 Cloudflare Workers 上進行 SSR，沒有 App.vue、沒有 vue-router，每個頁面獨立維護於 `src/views`。

## 檔案結構
- `src/views/*.vue`：頁面來源。
- `scripts/build-views.ts`：將 `.vue` 轉成 Worker 可用的 SSR 元件，輸出到 `src/.generated/views`。
- `scripts/prerender.ts`：使用 SSR 輸出靜態 HTML 到 `www/`。
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


## 靜態預先輸出
```bash
npm run build:static
```
會在 `www/` 產生 `index.html`等。若要近端預覽靜態檔：
```bash
npm run preview:static
```
（等同 `python3 -m http.server 4173 -d www`）

### 僅動態渲染、不要預先靜態的路由
- 不想預生成的頁面，直接從 `scripts/prerender.ts` 的 `pages` 陣列移除，並保留對應的 Hono 路由（例如在 `src/index.ts` 用 `renderHtml` 於收到請求時才渲染）。
- 若頁面只存在動態路由，仍需在部署或開發前先執行 `npm run build:views` 以生成 `src/.generated/views` 供 Worker 匯入。

## 部署
```bash
npm run deploy
```
會先編譯視圖再交給 `wrangler deploy`。靜態輸出在 `www/` 可獨立部署到 Pages 或其他靜態空間。

