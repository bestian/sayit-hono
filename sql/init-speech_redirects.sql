-- speech_redirects：把已被刪除/合併掉的 filename 永久 301 到正規版本。
-- 用法：當 /:filename 找不到對應的 speech_index 列時，會檢查這張表，命中即 301。
-- 注意：old_filename / new_filename 都是「未經 URL encode」的純值，
-- 與 speech_index.filename 一致。Route handler 會在輸出 Location 時做 encodeURIComponent。
-- 此表在這個檔案前已存在於 production D1（有歷史資料），這裡補上正式定義。
CREATE TABLE IF NOT EXISTS speech_redirects (
    old_filename TEXT PRIMARY KEY,
    new_filename TEXT NOT NULL
);
