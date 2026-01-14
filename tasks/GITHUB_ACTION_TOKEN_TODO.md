# GitHub Action Token TODO

## 目標
僅允許 `audreyt/transcript` 與 `bestian/transcript` 的 GitHub Actions 使用 `POST` / `PATCH` 呼叫 Cloudflare Worker，同時確保 token 不會出現在公開儲存庫中。

> ✅ **可以**：即使儲存庫是公開的，也能把 token 放在 GitHub 的 Repository Secrets（或 Organization Secrets、Environment Secrets）中。Secrets 不會出現在 Git history，也不會被下載，只有 Workflow 在執行時才能讀取。

---

## 步驟一：在 Cloudflare Worker 設定兩個秘密

在專案根目錄執行：

```bash
wrangler secret put AUDREYT_TRANSCRIPT_TOKEN
wrangler secret put BESTIAN_TRANSCRIPT_TOKEN
```

系統會提示輸入 token 值。這兩個值必須與 GitHub Actions 的 token 相同（可自行產生，例如 `openssl rand -hex 32`）。

---

## 步驟二：在 GitHub 建立對應 Secrets

對 `audreyt/transcript` 與 `bestian/transcript` 兩個儲存庫，各自進入：

```
Settings ➜ Secrets and variables ➜ Actions ➜ New repository secret
```

建立一個 Secret（名稱範例）：

| Repository              | Secret Name        | Secret Value                         |
|-------------------------|--------------------|--------------------------------------|
| `audreyt/transcript`    | `WORKER_TOKEN`     | 與 `AUDREYT_TRANSCRIPT_TOKEN` 相同值 |
| `bestian/transcript`    | `WORKER_TOKEN`     | 與 `BESTIAN_TRANSCRIPT_TOKEN` 相同值 |

> 你也可以為不同 repo 使用不同 secret 名稱，只要在 workflow 內引用時保持一致即可。

---

## 步驟三：在 GitHub Actions Workflow 中使用

於兩個儲存庫的 workflow（例如 `.github/workflows/deploy.yml`）中，發送請求給 Worker 時加上：

```yaml
headers:
  Authorization: Bearer ${{ secrets.WORKER_TOKEN }}
  X-GitHub-Repository: audreyt/transcript   # 或 bestian/transcript
```

> 確認 `X-GitHub-Repository` 的值與 Worker 程式碼中的 `ALLOWED_GITHUB_REPOS` 鍵值一致。

---

## 驗證建議

1. 使用 `wrangler dev` 或 `wrangler dev --remote` 啟動 Worker。
2. 從本機模擬 GitHub Action 發送 `POST`/`PATCH`，header 要與上方一致，確認 200/403 行為符合預期。
3. 從前端瀏覽器嘗試送 `POST`，應回傳 `405 Method not allowed`。

---

## 待辦清單

- [ ] 為 `audreyt/transcript` 建立 `WORKER_TOKEN` secret `openssl rand -hex 32`
- [ ] 為 `bestian/transcript` 建立 `WORKER_TOKEN` secret `openssl rand -hex 32`
- [ ] 將 token 值寫入 Cloudflare（`wrangler secret put AUDREYT_TRANSCRIPT_TOKEN`）
- [ ] 將 token 值寫入 Cloudflare（`wrangler secret put BESTIAN_TRANSCRIPT_TOKEN`）
- [ ] 在 workflow 中引用 header 並測試授權


