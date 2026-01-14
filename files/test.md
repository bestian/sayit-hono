# 測試 /api/upload_markdown API

本文件說明如何使用 curl 測試 `/api/upload_markdown` 路由。

## 前置需求

1. 確保 Worker 正在運行（使用 `wrangler dev` 或 `wrangler dev --remote`）
2. 確保已設定環境變數：
   - `AUDREYT_TRANSCRIPT_TOKEN`
   - `BESTIAN_TRANSCRIPT_TOKEN`

## 測試範例

### 1. 測試成功案例（正確的 TOKEN）

```bash
curl -X POST http://localhost:8787/api/upload_markdown \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{"markdown": "# Hello World\n\nThis is a test markdown content."}'
```

**預期回應：**
- 狀態碼：200
- 內容：回傳 markdown 原始內容
```
# Hello World

This is a test markdown content.
```

### 2. 測試失敗案例（缺少 TOKEN）

```bash
curl -X POST http://localhost:8787/api/upload_markdown \
  -H "Content-Type: application/json" \
  -d '{"markdown": "# Hello World\n\nThis is a test markdown content."}'
```

**預期回應：**
- 狀態碼：400
- 內容：`Forbidden`

### 3. 測試失敗案例（錯誤的 TOKEN）

```bash
curl -X POST http://localhost:8787/api/upload_markdown \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrong_token_12345" \
  -d '{"markdown": "# Hello World\n\nThis is a test markdown content."}'
```

**預期回應：**
- 狀態碼：400
- 內容：`Forbidden`

### 4. 測試失敗案例（錯誤的 TOKEN 格式）

```bash
curl -X POST http://localhost:8787/api/upload_markdown \
  -H "Content-Type: application/json" \
  -H "Authorization: wrong_token_12345" \
  -d '{"markdown": "# Hello World\n\nThis is a test markdown content."}'
```

**預期回應：**
- 狀態碼：400
- 內容：`Forbidden`

### 5. 測試失敗案例（缺少 markdown 欄位）

```bash
curl -X POST http://localhost:8787/api/upload_markdown \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{"content": "some content"}'
```

**預期回應：**
- 狀態碼：400
- 內容：`{"error":"Missing or invalid markdown field"}`

### 6. 測試失敗案例（無效的 JSON）

```bash
curl -X POST http://localhost:8787/api/upload_markdown \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d 'invalid json'
```

**預期回應：**
- 狀態碼：400
- 內容：`{"error":"Invalid JSON body"}`

### 7. 測試 CORS Preflight（OPTIONS 請求）

```bash
curl -X OPTIONS http://localhost:8787/api/upload_markdown \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  -v
```

**預期回應：**
- 狀態碼：200
- Headers 包含適當的 CORS 設定

## 使用實際的 TOKEN 測試

如果要使用實際的 TOKEN 進行測試，可以：

1. 從環境變數讀取 TOKEN：
```bash
# 假設你已經設定了環境變數
export TOKEN="your_actual_token_here"

curl -X POST http://localhost:8787/api/upload_markdown \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"markdown": "# Test\n\nThis is a test."}'
```

2. 或直接替換 `YOUR_TOKEN_HERE` 為實際的 TOKEN 值

## 注意事項

- 如果使用 `wrangler dev --remote`，請將 URL 改為實際的 Worker URL
- 確保 TOKEN 值與環境變數中設定的值一致
- 所有錯誤回應都會包含適當的 CORS headers
