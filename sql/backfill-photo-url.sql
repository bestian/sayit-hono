-- 一次性 backfill：把 speakers.photoURL IS NULL 但同 name 有兄弟 row 帶 photoURL 的，
-- 補上兄弟 row 的 photoURL（取 id 最小者）。
--
-- 起因：同一位講者在 D1 常有多筆 route_pathname（如 'Audrey%20Tang' / 'audrey-tang' /
-- 'audrey-tang-2'；唐鳳 8 筆 '%E5%94%90%E9%B3%B3-*'），其中只有部分 row 有 photoURL。
-- single-speech SSR 等多處走 LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
-- + sp.photoURL 直查表，遇到 NULL 就 fallback 到 placeholder。
--
-- 套用方式：
--   npx wrangler d1 execute sayit-database --remote --file sql/backfill-photo-url.sql
--
-- 之後再 bun run deploy:assets bump cacheKeyVersion 讓既有 R2 / Edge cache 失效。

UPDATE speakers
SET photoURL = (
    SELECT s2.photoURL FROM speakers s2
    WHERE s2.name = speakers.name AND s2.photoURL IS NOT NULL
    ORDER BY s2.id ASC LIMIT 1
)
WHERE photoURL IS NULL
AND EXISTS (
    SELECT 1 FROM speakers s2
    WHERE s2.name = speakers.name AND s2.photoURL IS NOT NULL
);
