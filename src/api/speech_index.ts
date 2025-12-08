import type { Context } from 'hono';

type Env = {
	Bindings: {
		DB: D1Database;
		ASSETS: Fetcher;
	};
};

export async function speechIndex(c: Context<Env>) {
	try {
		const result = await c.env.DB.prepare('SELECT filename, display_name FROM speech_index ORDER BY id ASC').all();

		if (!result.success) {
			return c.json({ error: 'Database query failed' }, 500);
		}

		const rows = result.results.map((row: any) => ({
			filename: row.filename,
			display_name: row.display_name
		}));

		return c.json(rows, 200);
	} catch (error) {
		console.error('[speech_index] query failed', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
}

