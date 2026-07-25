import { describe, expect, it } from 'vite-plus/test';
import { createMockEnv, dispatch, type MockWorkerEnv } from './helpers/mockEnv';

type PanelState = 'current' | 'restored' | 'unexpected';

type RepairOptions = {
	state: PanelState;
	postUpdateState?: PanelState;
	failUpdate?: boolean;
};

const BOOKEND_HTML = '<h2>Bookend II — Audrey Tang: mission, not race</h2>';

function createRepairEnv(options: RepairOptions): MockWorkerEnv {
	let state = options.state;
	const counts: Record<PanelState, Record<string, number>> = {
		current: {
			'63866693|63866850': 0,
			'63867957|63868114': 0,
			'2026-07-24-state-of-wikimedia-and-ai-panel|63868115|63868272': 158,
			'2026-07-24-「維基媒體與-ai-現況」座談|63868273|63868430': 158,
			'2026-07-24-state-of-wikimedia-and-ai-panel': 158,
			'2026-07-24-「維基媒體與-ai-現況」座談': 158,
		},
		restored: {
			'63866693|63866850': 158,
			'63867957|63868114': 158,
			'2026-07-24-state-of-wikimedia-and-ai-panel|63868115|63868272': 0,
			'2026-07-24-「維基媒體與-ai-現況」座談|63868273|63868430': 0,
			'2026-07-24-state-of-wikimedia-and-ai-panel': 158,
			'2026-07-24-「維基媒體與-ai-現況」座談': 158,
		},
		unexpected: {
			'63866693|63866850': 1,
			'63867957|63868114': 0,
			'2026-07-24-state-of-wikimedia-and-ai-panel|63868115|63868272': 158,
			'2026-07-24-「維基媒體與-ai-現況」座談|63868273|63868430': 158,
			'2026-07-24-state-of-wikimedia-and-ai-panel': 158,
			'2026-07-24-「維基媒體與-ai-現況」座談': 158,
		},
	};
	return createMockEnv((sql, args) => {
		if (sql.trim().startsWith('UPDATE speech_content')) {
			if (options.failUpdate) throw new Error('D1 unavailable');
			state = options.postUpdateState ?? 'restored';
			return { success: true, results: [] };
		}
		if (sql.startsWith('SELECT COUNT(*) AS count')) {
			const count = counts[state][args.join('|')];
			if (count === undefined) throw new Error(`Unexpected count query: ${sql}`);
			return { success: true, results: [{ count }] };
		}
		if (sql.startsWith('SELECT section_id, section_speaker, section_content')) {
			const sectionId = args[0];
			if (sectionId === 63868133 && state === 'current') {
				return { success: true, results: [{ section_id: 63868133, section_speaker: null, section_content: BOOKEND_HTML }] };
			}
			if (sectionId === 63866711 && state === 'restored') {
				return { success: true, results: [{ section_id: 63866711, section_speaker: null, section_content: BOOKEND_HTML }] };
			}
			return { success: true, results: [] };
		}
		throw new Error(`Unexpected query: ${sql}`);
	});
}

function request(env: MockWorkerEnv, authorization?: string) {
	return dispatch('/api/repair_panel_section_ids', env, {
		method: 'POST',
		headers: authorization ? { Authorization: authorization } : undefined,
	});
}

describe('POST /api/repair_panel_section_ids', () => {
	it('rejects an unauthenticated request', async () => {
		const { res } = await request(createRepairEnv({ state: 'current' }));
		expect(res.status).toBe(400);
	});

	it('reports a prior repair without writing again', async () => {
		const env = createRepairEnv({ state: 'restored' });
		const { res } = await request(env, 'Bearer token-audrey');
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ success: true, repaired: false });
		expect(env.__directStatements).toEqual([]);
	});

	it('refuses an unexpected section-ID layout', async () => {
		const env = createRepairEnv({ state: 'unexpected' });
		const { res } = await request(env, 'Bearer token-bestian');
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: 'Unexpected section-ID state' });
		expect(env.__directStatements).toEqual([]);
	});

	it('moves both panel ranges only after the exact preflight matches', async () => {
		const env = createRepairEnv({ state: 'current' });
		const { res } = await request(env, 'Bearer token-audrey');
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ success: true, repaired: true });
		expect(env.__directStatements).toHaveLength(1);
		expect(env.__directStatements[0].sql).toContain('section_id - 1422');
		expect(env.__directStatements[0].sql).toContain('section_id - 316');
	});

	it('does not claim success when D1 rejects the update', async () => {
		const { res } = await request(createRepairEnv({ state: 'current', failUpdate: true }), 'Bearer token-audrey');
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: 'Service temporarily unavailable' });
	});

	it('does not claim success when the post-update preflight fails', async () => {
		const { res } = await request(createRepairEnv({ state: 'current', postUpdateState: 'current' }), 'Bearer token-audrey');
		expect(res.status).toBe(500);
		expect(await res.json()).toMatchObject({ error: 'Section-ID repair verification failed' });
	});
});
