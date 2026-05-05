import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import { isAuthorizedFromHeader } from './auth';
import type { ApiEnv } from './types';

const corsMethods = 'GET, HEAD, OPTIONS, PUT';

export type RedirectPair = {
	old_filename: string;
	new_filename: string;
};

/**
 * 解析 .redirects dotfile 的純文字格式：每行 `old\tnew`，# 開頭為註解，空行略過。
 * 兩側都不含 .md 後綴（因為對應 speech_index.filename 也是不含後綴的）。
 */
export function parseRedirectsText(rawText: string | null | undefined): RedirectPair[] {
	const pairs: RedirectPair[] = [];
	if (!rawText) return pairs;

	for (const rawLine of rawText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const parts = line.split('\t');
		if (parts.length !== 2) continue;
		const oldFilename = parts[0].trim();
		const newFilename = parts[1].trim();
		if (oldFilename === newFilename) continue;
		pairs.push({ old_filename: oldFilename, new_filename: newFilename });
	}
	return pairs;
}

type DiffPlan = {
	toInsert: RedirectPair[];
	toUpdate: RedirectPair[];
	toDelete: string[];
};

/** 把 incoming snapshot 與 DB 現況比對，產出最小變更計畫。 */
export function planRedirectDiff(incoming: RedirectPair[], existing: RedirectPair[]): DiffPlan {
	const incomingByOld = new Map(incoming.map((p) => [p.old_filename, p.new_filename]));
	const existingByOld = new Map(existing.map((p) => [p.old_filename, p.new_filename]));

	const toInsert: RedirectPair[] = [];
	const toUpdate: RedirectPair[] = [];
	const toDelete: string[] = [];

	for (const [oldFilename, newFilename] of incomingByOld) {
		const current = existingByOld.get(oldFilename);
		if (current === undefined) {
			toInsert.push({ old_filename: oldFilename, new_filename: newFilename });
		} else if (current !== newFilename) {
			toUpdate.push({ old_filename: oldFilename, new_filename: newFilename });
		}
	}
	for (const oldFilename of existingByOld.keys()) {
		if (!incomingByOld.has(oldFilename)) {
			toDelete.push(oldFilename);
		}
	}

	return { toInsert, toUpdate, toDelete };
}

/**
 * PUT /api/redirects：用 .redirects snapshot 取代 speech_redirects 整張表。
 * Body 接受 text/plain（tab-separated）或 JSON `{ pairs: [{old, new}] }`。
 */
export async function redirectsSync(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const corsHeadersWithMethods = {
		...corsHeaders,
		'Access-Control-Allow-Methods': corsMethods
	};

	const authorized = await isAuthorizedFromHeader(
		c.req.header('Authorization'),
		c.env.AUDREYT_TRANSCRIPT_TOKEN,
		c.env.BESTIAN_TRANSCRIPT_TOKEN
	);
	if (!authorized) {
		return c.text('Forbidden', 400, corsHeadersWithMethods);
	}

	let incoming: RedirectPair[];
	if (c.req.header('Content-Type')?.includes('application/json')) {
		try {
			const body = (await c.req.json()) as { pairs?: unknown };
			if (!Array.isArray(body.pairs)) {
				return c.json({ error: 'JSON body must have pairs: [{old, new}]' }, 400, corsHeadersWithMethods);
			}
			incoming = [];
			for (const raw of body.pairs) {
				if (!raw || typeof raw !== 'object') {
					return c.json({ error: 'Each pair must be an object' }, 400, corsHeadersWithMethods);
				}
				const r = raw as { old?: unknown; new?: unknown };
				if (typeof r.old !== 'string' || typeof r.new !== 'string') {
					return c.json({ error: 'Each pair must have string old and new fields' }, 400, corsHeadersWithMethods);
				}
				const oldFilename = r.old.trim();
				const newFilename = r.new.trim();
				if (!oldFilename || !newFilename || oldFilename === newFilename) {
					return c.json(
						{ error: 'old/new must be non-empty and distinct' },
						400,
						corsHeadersWithMethods
					);
				}
				incoming.push({ old_filename: oldFilename, new_filename: newFilename });
			}
		} catch {
			return c.json({ error: 'Invalid JSON body' }, 400, corsHeadersWithMethods);
		}
	} else {
		const rawText = await c.req.text();
		incoming = parseRedirectsText(rawText);
	}

	// 同一 old_filename 出現兩次直接拒絕，避免 snapshot 不確定哪一筆贏
	const seen = new Set<string>();
	for (const pair of incoming) {
		if (seen.has(pair.old_filename)) {
			return c.json(
				{ error: `Duplicate old_filename in snapshot: ${pair.old_filename}` },
				400,
				corsHeadersWithMethods
			);
		}
		seen.add(pair.old_filename);
	}

	let existing: RedirectPair[];
	try {
		const result = await c.env.DB.prepare(
			'SELECT old_filename, new_filename FROM speech_redirects'
		).all();
		if (!result.success) {
			throw new Error('speech_redirects query failed');
		}
		existing = (result.results as Array<{ old_filename: string; new_filename: string }>).map((row) => ({
			old_filename: row.old_filename,
			new_filename: row.new_filename
		}));
	} catch (err) {
		console.error('[redirects] read error', err);
		return c.json({ error: 'Service temporarily unavailable' }, 503, corsHeadersWithMethods);
	}

	const plan = planRedirectDiff(incoming, existing);

	if (plan.toInsert.length === 0 && plan.toUpdate.length === 0 && plan.toDelete.length === 0) {
		return c.json(
			{ inserted: 0, updated: 0, deleted: 0, total: existing.length },
			200,
			corsHeadersWithMethods
		);
	}

	try {
		const stmts: Parameters<typeof c.env.DB.batch>[0] = [];
		for (const pair of plan.toInsert) {
			stmts.push(
				c.env.DB.prepare(
					'INSERT INTO speech_redirects (old_filename, new_filename) VALUES (?, ?)'
				).bind(pair.old_filename, pair.new_filename)
			);
		}
		for (const pair of plan.toUpdate) {
			stmts.push(
				c.env.DB.prepare(
					'UPDATE speech_redirects SET new_filename = ? WHERE old_filename = ?'
				).bind(pair.new_filename, pair.old_filename)
			);
		}
		for (const oldFilename of plan.toDelete) {
			stmts.push(
				c.env.DB.prepare('DELETE FROM speech_redirects WHERE old_filename = ?').bind(oldFilename)
			);
		}
		await c.env.DB.batch(stmts);
	} catch (err) {
		console.error('[redirects] batch error', err);
		return c.json({ error: 'Service temporarily unavailable' }, 503, corsHeadersWithMethods);
	}

	return c.json(
		{
			inserted: plan.toInsert.length,
			updated: plan.toUpdate.length,
			deleted: plan.toDelete.length,
			total: incoming.length
		},
		200,
		corsHeadersWithMethods
	);
}
