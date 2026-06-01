-- Atomic allocator for speech_content.section_id (a global INTEGER PRIMARY KEY).
--
-- Replaces the old "read MAX(section_id) then compute MAX+1.. in JS" pattern,
-- which raced across concurrent uploads (two requests read the same MAX, minted
-- the same ids, and collided on the PK -> HTTP 503). reserveSectionIds() bumps
-- next_id in a single atomic UPDATE ... RETURNING, so SQLite serialises
-- concurrent reservations into disjoint id blocks.
--
-- The application also creates/seeds this table lazily (CREATE TABLE IF NOT
-- EXISTS + INSERT OR IGNORE), so applying this migration is optional; it is kept
-- here for explicit provisioning and documentation. The seed value is irrelevant
-- because every reservation floors next_id at MAX(section_id)+1 (self-healing).
CREATE TABLE IF NOT EXISTS section_id_counter (
    id INTEGER PRIMARY KEY,
    next_id INTEGER NOT NULL
);

INSERT OR IGNORE INTO section_id_counter (id, next_id)
VALUES (1, (SELECT COALESCE(MAX(section_id), 0) + 1 FROM speech_content));
