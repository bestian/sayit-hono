DROP TABLE IF EXISTS speech_speakers;

CREATE TABLE IF NOT EXISTS speech_speakers (
    speech_filename TEXT NOT NULL,
    speaker_route_pathname TEXT NOT NULL,
	PRIMARY KEY (speech_filename, speaker_route_pathname)
);

CREATE INDEX IF NOT EXISTS idx_speech_speakers_speech_filename ON speech_speakers (speech_filename);
CREATE INDEX IF NOT EXISTS idx_speech_speakers_speaker_route_pathname ON speech_speakers (speaker_route_pathname);

INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname)
	VALUES ("2025-11-10-柏林自由會議ai-的角色", "%E5%94%90%E9%B3%B3-3");
