import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
	// 可以透過 c.env 訪問環境變數和 bindings (例如: c.env.DB, c.env.SPEECH_AN)
	// 可以透過 c.req 訪問 request
	return c.text('Hello Hono!');
});

export default app;
