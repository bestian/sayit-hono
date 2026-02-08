-- 為 speech_content 建立常用查詢的索引
-- 說明：
-- 1) section_id 已為 PRIMARY KEY，無需再建索引
-- 2) filename / nest_filename：前端查單檔或巢狀檔案時使用
-- 3) section_speaker：前端查講者相關段落時使用

-- 依檔名查所有段落
CREATE INDEX IF NOT EXISTS idx_speech_content_filename ON speech_content(filename);

-- 依巢狀檔名查段落
CREATE INDEX IF NOT EXISTS idx_speech_content_nest_filename ON speech_content(nest_filename);

-- 依講者查段落
CREATE INDEX IF NOT EXISTS idx_speech_content_section_speaker ON speech_content(section_speaker);

-- 檔名 + 巢檔複合索引，可精確鎖定單一巢檔（若不需要可移除）
CREATE INDEX IF NOT EXISTS idx_speech_content_filename_nest ON speech_content(filename, nest_filename);

