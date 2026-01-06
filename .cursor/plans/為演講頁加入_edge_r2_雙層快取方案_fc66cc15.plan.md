---
name: 為演講頁加入 Edge/R2 雙層快取方案
overview: ""
todos:
  - id: add-binding
    content: 增加 SPEECH_CACHE 型別/綁定與快取 helper
    status: pending
  - id: wire-routes
    content: 在三個演講 SSR 路由套用 Edge→R2→渲染快取流程
    status: pending
    dependencies:
      - add-binding
  - id: headers-errors
    content: 調整 Cache-Control/ETag 並避開 4xx/5xx 寫入快取
    status: pending
    dependencies:
      - wire-routes
  - id: todo-1767692009832-0azrbeirl
    content: 新增一個函式用來清快取，但暫無相關API
    status: pending
---

# 為演講頁加入 Edge/R2 雙層快取方案

1) 擴充快取資源與共用邏輯：在 `src/index.ts` 新增 `SPEECH_CACHE` 綁定型別，實作共用 helper（組合 cacheKey=完整 URL，`readEdgeCache`/`writeEdgeCache`、`readR2Cache`/`writeR2Cache`）並設定 Edge TTL 60 秒、R2 長期保存（無 TTL）。