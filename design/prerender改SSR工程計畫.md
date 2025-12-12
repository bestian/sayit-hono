# Prerender 改 SSR 工程計畫

## 前言

目前專案使用 prerender 方式預先產生所有頁面的靜態 HTML，但隨著資料量成長（演講 2000+ 筆、講者 8000+ 筆），prerender 的效能瓶頸日益明顯。本計畫旨在將大量詳細頁面從靜態 prerender 改為動態 SSR（Server-Side Rendering），以提升系統效能與維護性。

## 問題分析

### 目前 Prerender 的效能瓶頸

1. **規模問題**
   - 演講頁面：2000+ 筆 × (HTTP API 請求 + Vue SSR 渲染)
   - 講者頁面：8000+ 筆 × (HTTP API 請求 + Vue SSR 渲染)
   - 總計約 10,000+ 頁面需要預先生成

2. **效能瓶頸**
   - **HTTP 請求延遲**：每個頁面都需要透過 API fetch 取得資料（網路 I/O 開銷）
   - **Vue SSR 渲染成本**：`renderToString` 是 CPU 密集操作
   - **序列處理**：目前使用 `for` 迴圈逐一處理，無法充分利用並行

3. **時間估算**
   - 假設每個頁面：API 請求 100ms + 渲染 50ms = 150ms
   - 10,000 頁面 × 150ms = 1,500 秒 ≈ **25 分鐘**（序列處理）
   - 即使並行處理，仍會受到 API rate limit 和記憶體限制

## 解決方案：混合策略（Prerender + SSR）

### 核心概念

- **保留 Prerender**：簡單的列表頁面（首頁、演講列表、講者列表）
- **改為 SSR**：詳細頁面（單一演講頁、單一講者頁）
- **按需渲染**：只在使用者請求時才進行渲染，避免預先產生大量靜態檔案

### 選擇 SSR 的理由

1. **現有基礎設施完善**
   - 專案已有 SSR 基礎設施（`src/ssr/render.ts`）
   - `/speech/:section_id` 路由已是 SSR 實作，可直接參考擴展

2. **效能優勢**
   - **直接存取 D1**：SSR 在 Cloudflare Workers 執行，可直接存取 D1 資料庫，無需 HTTP API 開銷
   - **按需渲染**：只在需要時才渲染，避免浪費資源預先產生可能不會被訪問的頁面
   - **Cloudflare Workers 效能優異**：邊緣運算環境，回應速度快

3. **維護性提升**
   - **資料即時性**：資料更新時無需重新執行 prerender，SSR 會自動使用最新資料
   - **部署簡化**：減少靜態檔案數量，降低部署複雜度
   - **資源節省**：不需要儲存大量靜態 HTML 檔案

4. **SEO 無虞**
   - SSR 產生的 HTML 已包含完整內容，搜尋引擎可正常索引
   - 與 prerender 的 SEO 效果相同

## 重點整理

### 保留 Prerender 的頁面
- `index.html`（首頁）
- `speeches.html`（演講列表）
- `speakers.html`（講者列表）

### 改為 SSR 的頁面
- `/speech/:filename`（單一演講頁）
- `/speaker/:route_pathname`（單一講者頁）

### 技術要點
1. 在 `src/index.ts` 新增 SSR 路由
2. 直接從 D1 資料庫讀取資料（參考現有 API 實作）
3. 使用現有的 `renderHtml` 函數進行 SSR
4. 確保路由優先順序：靜態資源 → SSR 路由 → 404 fallback

## 施工順序

### 階段一：準備工作
1. ✅ 確認現有 SSR 基礎設施（`src/ssr/render.ts`）
2. ✅ 確認現有 API 實作（`src/api/speech.ts`, `src/api/speaker_detail.ts`）
3. ✅ 確認現有 SSR 路由範例（`/speech/:section_id`）

### 階段二：實作演講頁 SSR
1. 在 `src/index.ts` 新增 `/speech/:filename` SSR 路由
2. 從 D1 讀取演講資料（參考 `src/api/speech.ts`）
3. 使用 `SingleSpeechView` 元件進行 SSR
4. 處理路由參數（URL 編碼/解碼）
5. 測試路由是否正常運作

### 階段三：實作講者頁 SSR
1. 在 `src/index.ts` 新增 `/speaker/:route_pathname` SSR 路由
2. 從 D1 讀取講者資料（參考 `src/api/speaker_detail.ts`）
3. 使用 `SingleSpeakerView` 元件進行 SSR
4. 處理路由參數（URL 編碼/解碼）
5. 測試路由是否正常運作

### 階段四：調整 Prerender
1. 修改 `scripts/prerender.ts`，移除大量頁面生成邏輯
2. 保留簡單頁面的 prerender（首頁、列表頁）
3. 移除 `speechPages` 和 `speakerPages` 的生成迴圈
4. 更新註解說明新的架構

### 階段五：路由優先順序調整
1. 確認靜態資源路由優先（`/favicon.ico`, `/robots.txt`, `/static/*`）
2. 確認列表頁靜態路由（`/speeches`, `/speakers`）
3. 確認 SSR 路由順序正確
4. 確認 404 fallback 邏輯

### 階段六：測試與驗證
1. 測試演講頁 SSR 是否正常運作
2. 測試講者頁 SSR 是否正常運作
3. 測試列表頁 prerender 是否正常運作
4. 驗證 SEO（檢查 HTML 內容是否完整）
5. 效能測試（回應時間、並發處理）

### 階段七：清理與文件
1. 清理 `www/` 目錄中不再需要的靜態檔案（可選）
2. 更新 `README.md` 說明新的架構
3. 更新相關文件說明 prerender 與 SSR 的使用情境

## 注意事項

1. **路由優先順序**：確保靜態資源和列表頁路由在 SSR 路由之前
2. **錯誤處理**：SSR 路由需要適當的錯誤處理（404、500 等）
3. **URL 編碼**：注意 `filename` 和 `route_pathname` 的 URL 編碼/解碼處理
4. **向後相容**：確保現有的 URL 結構仍然有效
5. **效能監控**：部署後監控 SSR 回應時間，必要時進行優化

## 預期效益

1. **建置時間**：從 25+ 分鐘降至數秒（只 prerender 3 個簡單頁面）
2. **部署大小**：大幅減少靜態檔案數量
3. **資料即時性**：SSR 自動使用最新資料，無需重新 prerender
4. **維護成本**：降低維護複雜度，提升開發效率

