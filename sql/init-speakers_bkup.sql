DROP TABLE IF EXISTS speakers;

CREATE TABLE IF NOT EXISTS speakers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_pathname TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    photoURL TEXT,
	appearances_count INTEGER DEFAULT 0,
    scetions_count INTEGER DEFAULT 0,
    scetions TEXT, -- JSON array of scetions
    longest_scetion TEXT -- JSON object of longest scetion
);



insert into speakers (route_pathname, name, photoURL, appearances_count, scetions_count, scetions, longest_scetion) -- 目前是第一筆填充資料，只是確立格式，未來需要修改為完整
	values (
		'%E5%94%90%E9%B3%B3-3',
		'唐鳳',
	    'https://sayit.archive.tw/media/speakers/default/pic_AudreyTang-small.jpg.96x96_q85_crop-smart_face_upscale.jpg',
		1036,
		95581,
		'[
			{"section_content": "謝謝大家。","scetion_filename": "2025-11-10-柏林自由會議ai-的角色", "section_id": 628242},
			{"section_content": "聽說「奇點即將接近」—— 多元宇宙，已經來臨。","scetion_filename": "2025-11-10-柏林自由會議ai-的角色", "section_id": 628241}

		]',
		'{"section_content": "...","scetion_filename": "2025-03-03-日經新聞採訪", "section_id": 621538}');

