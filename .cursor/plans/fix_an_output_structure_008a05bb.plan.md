---
name: Fix AN output structure
overview: "Align generated .an with sample: nested heading, from tag, and first-occurrence TLCPerson order"
todos: []
---

# 修正 AN 產出

- **nested-section**：在 `src/api/an.ts` 生成時，若 `speech_content.nested_filename` 有值，於 `<debateSection>` 下新增子 `<debateSection>`，`<heading>` 用該值，並將敘事/發言都放入此子節點；若無值則保持單層。
- **from-tag**：在 `<speech>` 內插入 `<from>`，內容使用解碼後的 `section_speaker`。
- **參照順序**：保持 TLCPerson 依段落首次出現順序（現有邏輯），並確認套用於新 nested 結構。
- **內容相容**：保留現有 HTML 內文，仍轉換 `&nbsp;`→`&#160;`；頂層 `<heading>` 繼續用 `speech_index.display_name` 或檔名。
