DROP VIEW IF EXISTS speakers_view;

CREATE VIEW speakers_view AS
WITH longest_section AS (
    SELECT
        sc.section_speaker,
        sc.section_id,
        sc.section_content,
        sc.filename,
        sc.nest_filename,
        sc.nest_display_name,
        si.display_name,
        ROW_NUMBER() OVER (
            PARTITION BY sc.section_speaker
            ORDER BY LENGTH(sc.section_content) DESC, sc.section_id ASC
        ) AS rn
    FROM speech_content sc
    LEFT JOIN speech_index si ON sc.filename = si.filename
    WHERE sc.section_content IS NOT NULL
      AND sc.section_content != ''
      AND sc.section_speaker IS NOT NULL
      AND sc.section_speaker != ''
)
SELECT
    s.id,
    s.route_pathname,
    s.name,
    s.photoURL,
    COALESCE((
        SELECT COUNT(DISTINCT ss.speech_filename)
        FROM speech_speakers ss
        WHERE ss.speaker_route_pathname = s.route_pathname
    ), 0) AS appearances_count,
    COALESCE((
        SELECT COUNT(DISTINCT sc.section_id)
        FROM speech_content sc
        WHERE sc.section_speaker = s.route_pathname
    ), 0) AS sections_count,
    ls.section_id AS longest_section_id,
    ls.section_content AS longest_section_content,
    ls.filename AS longest_section_filename,
    ls.nest_filename AS longest_section_nest_filename,
    ls.nest_display_name AS longest_section_nest_display_name,
    ls.display_name AS longest_section_displayname
FROM speakers s
LEFT JOIN longest_section ls
    ON s.route_pathname = ls.section_speaker
    AND ls.rn = 1;

