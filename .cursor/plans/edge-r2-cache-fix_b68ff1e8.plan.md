---
name: edge-r2-cache-fix
overview: 修正 SSR 快取鍵與雙層快取流程，確保 edge cache 與 R2 在本地/遠端都可用
todos:
  - id: fix-cache-key
    content: 修正 buildCacheKey 產生完整 URL
    status: pending
  - id: align-cache-io
    content: 統一 edge/R2 讀寫使用同 key
    status: pending
    dependencies:
      - fix-cache-key
  - id: log-and-verify
    content: 簡化日誌並在 remote preview 驗證命中
    status: pending
    dependencies:
      - align-cache-io
---

# Edge/R2 快取修正計畫

## 目標

- 修正 cache key 生成，避免 `Invalid URL`，確保 edge cache 與 R2 cache 在本地 remote preview 及正式環境皆可命中。
- 確認並串接 edge → R2 → source 的回退與寫入邏輯。

## 主要修改檔案

- `src/index.ts`

## 步驟

1. **修正 cache key 生成**

- 調整 `buildCacheKey`：使用完整絕對 URL（含 `https://`）或 `new URL(url).toString()`，避免 `Invalid URL`。

2. **統一讀寫用相同 key**

- 確認 `readEdgeCache`/`writeEdgeCache`、`readR2Cache`/`writeR2Cache` 全程使用同一標準化 key，避免 miss。

3. **日誌與錯誤處理微調**

- 在 edge/R2 miss/錯誤時記錄 key，保持簡短，方便本地/遠端除錯。

4. **驗證流程**

- 在 remote preview 以同一路徑連續請求：第一次走源並寫入；第二次命中 edge；edge miss 時命中 R2。記錄觀察輸出以確認命中情況。
