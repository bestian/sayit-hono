DROP TABLE IF EXISTS homepage_search;

-- FTS5 索引用於首頁搜尋，涵蓋講者名稱與段落內容
CREATE VIRTUAL TABLE homepage_search USING fts5(
    doc_type UNINDEXED,         -- 'speaker' 或 'section'
    route_pathname UNINDEXED,   -- 講者路徑（段落時為 section_speaker）
    name,                       -- 講者名稱或講者顯示名稱（參與段落時）
    content,                    -- 段落內容或講者名稱（便於全文檢索）
    filename UNINDEXED,         -- 所屬演講檔名
    nest_filename UNINDEXED,    -- 巢狀子項檔名
    section_id UNINDEXED,       -- 段落 ID
    display_name UNINDEXED,     -- 演講顯示名稱
    photoURL UNINDEXED,         -- 講者頭像
    tokenize = 'unicode61'
);

-- 講者資料：名稱以全文索引，其他欄位僅儲存
INSERT INTO homepage_search (
    doc_type,
    route_pathname,
    name,
    content,
    filename,
    nest_filename,
    section_id,
    display_name,
    photoURL
) SELECT
    'speaker',
    s.route_pathname,
    s.name,
    s.name,
    NULL,
    NULL,
    NULL,
    s.name,
    s.photoURL
FROM speakers s
WHERE s.name IS NOT NULL
  AND TRIM(s.name) != '';

-- 段落資料：以段落內容與講者名稱（如有）建立全文索引
INSERT INTO homepage_search (
    doc_type,
    route_pathname,
    name,
    content,
    filename,
    nest_filename,
    section_id,
    display_name,
    photoURL
) SELECT
    'section',
    sc.section_speaker,
    COALESCE(sp.name, sc.section_speaker, ''),
    COALESCE(sc.section_content, ''),
    sc.filename,
    sc.nest_filename,
    sc.section_id,
    COALESCE(si.display_name, sc.filename),
    sp.photoURL
FROM speech_content sc
LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
LEFT JOIN speech_index si ON sc.filename = si.filename
WHERE sc.section_content IS NOT NULL
  AND TRIM(sc.section_content) != '';

-- 選擇性：優化 FTS 索引
INSERT INTO homepage_search(homepage_search) VALUES('optimize');

--------------------------------------------------------------------------------
-- Triggers：維持首頁搜尋索引與主資料表同步
--------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_homepage_speaker_insert;
DROP TRIGGER IF EXISTS trg_homepage_speaker_update;
DROP TRIGGER IF EXISTS trg_homepage_speaker_delete;

DROP TRIGGER IF EXISTS trg_homepage_section_insert;
DROP TRIGGER IF EXISTS trg_homepage_section_update;
DROP TRIGGER IF EXISTS trg_homepage_section_delete;

DROP TRIGGER IF EXISTS trg_homepage_speech_index_insert;
DROP TRIGGER IF EXISTS trg_homepage_speech_index_update;
DROP TRIGGER IF EXISTS trg_homepage_speech_index_delete;

-- 講者：插入
CREATE TRIGGER trg_homepage_speaker_insert
AFTER INSERT ON speakers
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'speaker' AND route_pathname = NEW.route_pathname;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    ) VALUES (
        'speaker',
        NEW.route_pathname,
        NEW.name,
        NEW.name,
        NULL, NULL, NULL,
        NEW.name,
        NEW.photoURL
    );

    -- 受影響的段落：重新寫入以套用新講者名稱/頭像
    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND route_pathname = NEW.route_pathname;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    )
    SELECT
        'section',
        sc.section_speaker,
        COALESCE(sp.name, sc.section_speaker, ''),
        COALESCE(sc.section_content, ''),
        sc.filename,
        sc.nest_filename,
        sc.section_id,
        COALESCE(si.display_name, sc.filename),
        sp.photoURL
    FROM speech_content sc
    LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
    LEFT JOIN speech_index si ON sc.filename = si.filename
    WHERE sc.section_speaker = NEW.route_pathname
      AND sc.section_content IS NOT NULL
      AND TRIM(sc.section_content) != '';
END;

-- 講者：更新（名稱、頭像變更時重建）
CREATE TRIGGER trg_homepage_speaker_update
AFTER UPDATE ON speakers
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'speaker' AND route_pathname = OLD.route_pathname;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    ) VALUES (
        'speaker',
        NEW.route_pathname,
        NEW.name,
        NEW.name,
        NULL, NULL, NULL,
        NEW.name,
        NEW.photoURL
    );

    -- 受影響的段落同步名稱/頭像
    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND route_pathname = OLD.route_pathname;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    )
    SELECT
        'section',
        sc.section_speaker,
        COALESCE(sp.name, sc.section_speaker, ''),
        COALESCE(sc.section_content, ''),
        sc.filename,
        sc.nest_filename,
        sc.section_id,
        COALESCE(si.display_name, sc.filename),
        sp.photoURL
    FROM speech_content sc
    LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
    LEFT JOIN speech_index si ON sc.filename = si.filename
    WHERE sc.section_speaker = NEW.route_pathname
      AND sc.section_content IS NOT NULL
      AND TRIM(sc.section_content) != '';
END;

-- 講者：刪除（段落仍保留，但講者名稱改用 route_pathname）
CREATE TRIGGER trg_homepage_speaker_delete
AFTER DELETE ON speakers
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'speaker' AND route_pathname = OLD.route_pathname;

    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND route_pathname = OLD.route_pathname;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    )
    SELECT
        'section',
        sc.section_speaker,
        COALESCE(sp.name, sc.section_speaker, ''),
        COALESCE(sc.section_content, ''),
        sc.filename,
        sc.nest_filename,
        sc.section_id,
        COALESCE(si.display_name, sc.filename),
        sp.photoURL
    FROM speech_content sc
    LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
    LEFT JOIN speech_index si ON sc.filename = si.filename
    WHERE sc.section_speaker = OLD.route_pathname
      AND sc.section_content IS NOT NULL
      AND TRIM(sc.section_content) != '';
END;

-- 段落：插入
CREATE TRIGGER trg_homepage_section_insert
AFTER INSERT ON speech_content
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND section_id = NEW.section_id;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    )
    SELECT
        'section',
        NEW.section_speaker,
        COALESCE(sp.name, NEW.section_speaker, ''),
        COALESCE(NEW.section_content, ''),
        NEW.filename,
        NEW.nest_filename,
        NEW.section_id,
        COALESCE(si.display_name, NEW.filename),
        sp.photoURL
    FROM speakers sp
    LEFT JOIN speech_index si ON NEW.filename = si.filename
    WHERE sp.route_pathname = NEW.section_speaker
       OR NEW.section_speaker IS NULL
       OR NEW.section_speaker = '';
END;

-- 段落：更新
CREATE TRIGGER trg_homepage_section_update
AFTER UPDATE ON speech_content
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND section_id = OLD.section_id;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    )
    SELECT
        'section',
        NEW.section_speaker,
        COALESCE(sp.name, NEW.section_speaker, ''),
        COALESCE(NEW.section_content, ''),
        NEW.filename,
        NEW.nest_filename,
        NEW.section_id,
        COALESCE(si.display_name, NEW.filename),
        sp.photoURL
    FROM speakers sp
    LEFT JOIN speech_index si ON NEW.filename = si.filename
    WHERE sp.route_pathname = NEW.section_speaker
       OR NEW.section_speaker IS NULL
       OR NEW.section_speaker = '';
END;

-- 段落：刪除
CREATE TRIGGER trg_homepage_section_delete
AFTER DELETE ON speech_content
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND section_id = OLD.section_id;
END;

-- speech_index：插入/更新/刪除時，重建該演講的段落索引以刷新 display_name
CREATE TRIGGER trg_homepage_speech_index_insert
AFTER INSERT ON speech_index
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND filename = NEW.filename;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    )
    SELECT
        'section',
        sc.section_speaker,
        COALESCE(sp.name, sc.section_speaker, ''),
        COALESCE(sc.section_content, ''),
        sc.filename,
        sc.nest_filename,
        sc.section_id,
        COALESCE(NEW.display_name, sc.filename),
        sp.photoURL
    FROM speech_content sc
    LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
    WHERE sc.filename = NEW.filename
      AND sc.section_content IS NOT NULL
      AND TRIM(sc.section_content) != '';
END;

CREATE TRIGGER trg_homepage_speech_index_update
AFTER UPDATE ON speech_index
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND filename = OLD.filename;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    )
    SELECT
        'section',
        sc.section_speaker,
        COALESCE(sp.name, sc.section_speaker, ''),
        COALESCE(sc.section_content, ''),
        sc.filename,
        sc.nest_filename,
        sc.section_id,
        COALESCE(NEW.display_name, sc.filename),
        sp.photoURL
    FROM speech_content sc
    LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
    WHERE sc.filename = NEW.filename
      AND sc.section_content IS NOT NULL
      AND TRIM(sc.section_content) != '';
END;

CREATE TRIGGER trg_homepage_speech_index_delete
AFTER DELETE ON speech_index
BEGIN
    DELETE FROM homepage_search
    WHERE doc_type = 'section' AND filename = OLD.filename;

    INSERT INTO homepage_search(
        doc_type, route_pathname, name, content,
        filename, nest_filename, section_id, display_name, photoURL
    )
    SELECT
        'section',
        sc.section_speaker,
        COALESCE(sp.name, sc.section_speaker, ''),
        COALESCE(sc.section_content, ''),
        sc.filename,
        sc.nest_filename,
        sc.section_id,
        COALESCE(sc.filename, sc.filename),
        sp.photoURL
    FROM speech_content sc
    LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
    WHERE sc.filename = OLD.filename
      AND sc.section_content IS NOT NULL
      AND TRIM(sc.section_content) != '';
END;

