import { Hono } from 'hono';
import AboutView, { styles as AboutViewStyles } from './.generated/views/AboutView';
import HomeView, { styles as HomeViewStyles } from './.generated/views/HomeView';
import { renderHtml } from './ssr/render';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
	const html = await renderHtml(HomeView, { title: 'Home', styles: HomeViewStyles });
	return c.html(html);
});

app.get('/about', async (c) => {
	const html = await renderHtml(AboutView, { title: 'About', styles: AboutViewStyles });
	return c.html(html);
});

app.notFound((c) => c.text('Not Found', 404));

export default app;
