import { Hono } from 'hono';
import { speechIndex } from './api/speech_index';
import { handleOptions } from './api/cors';
import { speakersIndex } from './api/speakers_index';
import { speakerDetail } from './api/speaker_detail';
import { speechContent } from './api/speech';
import { sectionDetail } from './api/section';
import { speechAn } from './api/an';

type WorkerEnv = {
	ASSETS: Fetcher;
	DB: D1Database;
	SPEECH_AN: R2Bucket;
};

const app = new Hono<{ Bindings: WorkerEnv }>();

async function serveAsset(c: any, path?: string) {
	const url = new URL(c.req.url);
	const assetUrl = path ? new URL(path, url) : url;
	return c.env.ASSETS.fetch(assetUrl.toString());
}

app.get('/', (c) => serveAsset(c, '/index.html'));

// Speeches 靜態頁
app.get('/speeches', (c) => serveAsset(c, '/speeches.html'));
app.get('/speeches/', (c) => serveAsset(c, '/speeches/index.html'));

// API CORS preflight
app.options('/api/*', (c) => handleOptions(c));

// D1 APIs
app.get('/api/speech_index.json', (c) => speechIndex(c));
app.get('/api/speakers_index.json', (c) => speakersIndex(c));
app.get('/api/speaker_detail/:route_pathname_with_json', (c) => speakerDetail(c));
app.get('/api/speech/*', (c) => speechContent(c));
app.get('/api/section/:section_id', (c) => sectionDetail(c));
app.on(['GET', 'HEAD'], '/api/an/*', (c) => speechAn(c));

// 直接映射根層靜態檔案
app.get('/favicon.ico', (c) => serveAsset(c, '/favicon.ico'));
app.get('/robots.txt', (c) => serveAsset(c, '/robots.txt'));

// 其餘請求交給靜態資源或返回 404
app.get('*', async (c) => {
	const res = await serveAsset(c);
	if (res.ok) return res;
	return c.text('Not Found', 404);
});

export default app;
