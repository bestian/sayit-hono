DROP TABLE IF EXISTS speakers;

CREATE TABLE IF NOT EXISTS speakers (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_pathname TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    photoURL TEXT
);

CREATE INDEX IF NOT EXISTS idx_speakers_route_pathname ON speakers (route_pathname);

-- insert into speakers (route_pathname, name, photoURL) -- 目前是第一筆填充資料，只是確立格式，未來需要修改為完整
--	values (
--		'%E5%94%90%E9%B3%B3-3',
--		'唐鳳',
--	    '/media/speakers/default/pic_AudreyTang-small.jpg.96x96_q85_crop-smart_face_upscale.jpg'
--	);

-- note: 不再放第一筆資料。跑完後需要填充資料，請使用 fill-speakers.sql 填充資料
