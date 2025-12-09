import { Hono } from 'hono';
import { speechIndex } from './api/speech_index';
import { handleOptions } from './api/cors';
import { speakersIndex } from './api/speakers_index';
import { speakerDetail } from './api/speaker_detail';
import { speechContent } from './api/speech';
import { sectionDetail } from './api/section';
import { speechAn } from './api/an';
import SingleParagraphView, { styles as SingleParagraphViewStyles } from './.generated/views/SingleParagraphView';
import Navbar, { styles as NavbarStyles } from './.generated/components/Navbar';
import Footer, { styles as FooterStyles } from './.generated/components/Footer';
import { renderHtml } from './ssr/render';
import { headForSpeechContent } from './ssr/heads';

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

function parseContent(raw?: string | null) {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'string' ? parsed : raw;
	} catch {
		return raw;
	}
}

function toPlainText(html: string) {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function loadSection(c: any, sectionId: number) {
	const result = await c.env.DB.prepare('SELECT * FROM sections WHERE section_id = ?').bind(sectionId).all();
	if (!result.success) throw new Error('Database query failed');
	if (result.results.length === 0) return null;
	return result.results[0] as any;
}

app.get('/', (c) => serveAsset(c, '/index.html'));

// Speeches 靜態頁
app.get('/speeches', (c) => serveAsset(c, '/speeches.html'));
app.get('/speeches/', (c) => serveAsset(c, '/speeches/index.html'));
// Speakers 靜態頁
app.get('/speakers', (c) => serveAsset(c, '/speakers.html'));
app.get('/speakers/', (c) => serveAsset(c, '/speakers/index.html'));

// API CORS preflight
app.options('/api/*', (c) => handleOptions(c));

// D1 APIs
app.get('/api/speech_index.json', (c) => speechIndex(c));
app.get('/api/speakers_index.json', (c) => speakersIndex(c));
app.get('/api/speaker_detail/:route_pathname_with_json', (c) => speakerDetail(c));
app.get('/api/speech/*', (c) => speechContent(c));
app.get('/api/section/:section_id', (c) => sectionDetail(c));
app.on(['GET', 'HEAD'], '/api/an/*', (c) => speechAn(c));

// 動態段落頁（不預先產生）
app.get('/speech/:section_id', async (c) => {
	const sectionIdParam = c.req.param('section_id');
	const sectionId = Number(sectionIdParam);

	if (!Number.isInteger(sectionId)) {
		return c.text('Bad Request', 400);
	}

	let section: any;
	try {
		section = await loadSection(c, sectionId);
	} catch (err) {
		console.error('[speech page] DB error', err);
		return c.text('Internal Server Error', 500);
	}

	if (!section) {
		return c.text('Not Found', 404);
	}

	const sectionHtml = parseContent(section.section_content ?? '');
	const plain = toPlainText(sectionHtml);
	const snippet = plain ? `${plain.slice(0, 80)}${plain.length > 80 ? '...' : ''}` : section.display_name ?? '';
	const titleText = snippet ? `“${snippet}”` : 'View Section';
	const styles = [SingleParagraphViewStyles, NavbarStyles, FooterStyles].filter(Boolean).join('\n');

	const head = headForSpeechContent(titleText, sectionHtml);
	const html = await renderHtml(SingleParagraphView, {
		head,
		styles,
		components: { Navbar, Footer },
		props: { section }
	});

	return c.html(html);
});

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
