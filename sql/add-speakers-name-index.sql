-- Speeds up the photoURL correlated subquery used by speakers listing
-- (speakers_index API + home/speakers SSR) and getSpeakerDetail's photo
-- fallback: each seek is on speakers(name) where photoURL IS NOT NULL.
--
-- Apply (remote production):
--   npx wrangler d1 execute sayit-database --remote --file=sql/add-speakers-name-index.sql
-- Apply (staging):
--   npx wrangler d1 execute sayit-database-staging --remote --env staging --file=sql/add-speakers-name-index.sql
-- Apply (local):
--   npx wrangler d1 execute sayit-database --local --file=sql/add-speakers-name-index.sql

CREATE INDEX IF NOT EXISTS idx_speakers_name_photo ON speakers (name) WHERE photoURL IS NOT NULL;
