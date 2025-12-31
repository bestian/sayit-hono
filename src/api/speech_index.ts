import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

function toStringArray(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) {
		return value.map((item) => String(item)).filter((item) => item.length > 0);
	}
	if (typeof value !== 'string') return [];

	const trimmed = value.trim();
	if (!trimmed) return [];

	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			return parsed.map((item) => String(item)).filter((item) => item.length > 0);
		}
	} catch {
		// fall through to delimiter based parsing
	}

	return trimmed
		.split(/[,;\n\r]+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function buildNestPairs(filenames: string[], displayNames: string[]) {
	return filenames.map((name, index) => ({
		filename: name,
		display_name: displayNames[index] ?? name
	}));
}

export async function speechIndex(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	try {
		const result = await c.env.DB.prepare(
			'SELECT filename, display_name, isNested, nest_filenames, nest_display_names FROM speech_index ORDER BY id ASC'
		).all();

		if (!result.success) {
			return c.json({ error: 'Database query failed' }, 500, corsHeaders);
		}

		const rows = result.results.map((row: any) => ({
			filename: row.filename,
			display_name: row.display_name,
			isNested: Boolean(row.isNested),
			nest_filenames: toStringArray(row.nest_filenames),
			nest_display_names: toStringArray(row.nest_display_names),
			nest: buildNestPairs(
				toStringArray(row.nest_filenames),
				toStringArray(row.nest_display_names)
			)
		}));

		return c.json(rows, 200, corsHeaders);
	} catch (error) {
		console.error('[speech_index] query failed', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeaders);
	}
}

