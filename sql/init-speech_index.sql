DROP TABLE IF EXISTS speech_index;

CREATE TABLE IF NOT EXISTS speech_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    isNested INTEGER DEFAULT 0,
    nest_filenames TEXT,
    nest_display_names TEXT
    -- speakers TEXT
);

-- insert into speech_index (filename, display_name, isNested, nest_filenames, nest_display_names)
-- values ('2025-11-10-柏林自由會議ai-的角色', '2025-11-10 柏林自由會議：AI 的角色', 0, '', '');
-- insert into speech_index (filename, display_name, isNested, nest_filenames, nest_display_names)
-- values ('2025-11-10-berlin-freedom-conference-the-role-of-a', '2025-11-10 Berlin Freedom Conference: The Role of AI', 0, '', '');

