-- Add alternate_filename column for parallel text / language switch
ALTER TABLE speech_index ADD COLUMN alternate_filename TEXT;

-- Link the two parallel texts
UPDATE speech_index SET alternate_filename = '2026-03-13-仁工智慧對話' WHERE filename = '2026-03-13-a-dialogue-on-civic-ai';
UPDATE speech_index SET alternate_filename = '2026-03-13-a-dialogue-on-civic-ai' WHERE filename = '2026-03-13-仁工智慧對話';
