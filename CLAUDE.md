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
