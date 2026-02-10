# API 測試清單

## 公開 API

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

## 需認證 API：upload_markdown

近端路由：`http://localhost:8787/api/upload_markdown`

需在 header 帶入 `Authorization: Bearer {{TOKEN}}`（`{{TOKEN}}` 為 `AUDREYT_TRANSCRIPT_TOKEN` 或 `BESTIAN_TRANSCRIPT_TOKEN`）。

### DELETE 刪除指定 filename 的紀錄


```bash
curl -X DELETE "http://localhost:8787/api/upload_markdown" \
  -H "Authorization: Bearer {{TOKEN}}" \
  -H "Content-Type: application/json" \
  -d '{"filename":"test_upload.md"}'
```


```bash
curl -X DELETE "http://localhost:8787/api/upload_markdown" \
  -H "Authorization: Bearer {{TOKEN}}" \
  -H "Content-Type: application/json" \
  -d '{"filename":"2025-11-10-柏林自由會議ai-的角色"}'
```


### POST 新增指定 filename 記錄

```bash
curl -X POST "http://localhost:8787/api/upload_markdown" \
  -H "Authorization: Bearer {{TOKEN}}" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rs '{filename: "test_upload.md", markdown: .}' raw_input_data/test_upload.md)"
```


```bash
curl -X POST "http://localhost:8787/api/upload_markdown" \
  -H "Authorization: Bearer {{TOKEN}}" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rs '{filename: "2025-11-10-柏林自由會議-AI-的角色.md", markdown: .}' raw_input_data/2025-11-10-柏林自由會議-AI-的角色.md)"
```
