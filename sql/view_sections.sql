DROP VIEW IF EXISTS sections;

CREATE VIEW sections AS
SELECT
    a.filename,
    a.nest_filename,
    a.nest_display_name,
    a.section_id,
    a.previous_section_id,
    a.next_section_id,
    a.section_speaker,
    a.section_content,
    -- 1. display_name from speech_index
    si.display_name,
    -- 2. photoURL and name from speakers
    sp.photoURL,
    sp.name,
    -- 3. previous_content: find section where b.next_section_id = a.section_id
    prev_section.section_content AS previous_content,
    -- 4. next_content: find section where b.previous_section_id = a.section_id
    next_section.section_content AS next_content
FROM
    speech_content a
    -- Join with speech_index to get display_name
    LEFT JOIN speech_index si ON a.filename = si.filename
    -- Join with speakers to get photoURL and name
    LEFT JOIN speakers sp ON a.section_speaker = sp.route_pathname
    -- Self-join to get previous_content (where b.next_section_id = a.section_id)
    LEFT JOIN speech_content prev_section ON a.section_id = prev_section.next_section_id
    -- Self-join to get next_content (where b.previous_section_id = a.section_id)
    LEFT JOIN speech_content next_section ON a.section_id = next_section.previous_section_id;

