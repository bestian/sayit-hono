import { Hono } from 'hono';
import { speechIndex } from './api/speech_index';

type WorkerEnv = {
	ASSETS: Fetcher;
	DB: D1Database;
};

const app = new Hono<{ Bindings: WorkerEnv }>();

async function serveAsset(c: any, path?: string) {
	const url = new URL(c.req.url);
	const assetUrl = path ? new URL(path, url) : url;
	return c.env.ASSETS.fetch(assetUrl.toString());
}

app.get('/', (c) => serveAsset(c, '/index.html'));

// 僅支援 /about，不做 /about/ 的重新導向
app.get('/about', (c) => serveAsset(c, '/about.html'));
app.get('/about/', (c) => serveAsset(c, '/about/index.html'));

// Speeches 靜態頁
app.get('/speeches', (c) => serveAsset(c, '/speeches.html'));
app.get('/speeches/', (c) => serveAsset(c, '/speeches/index.html'));

// D1 speech_index API
app.get('/api/speech_index.json', (c) => speechIndex(c));

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
