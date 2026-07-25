import type { Context } from 'hono';
import { isAuthorizedFromHeader } from './auth';
import type { ApiEnv } from './types';

const ENGLISH_FILENAME = '2026-07-24-state-of-wikimedia-and-ai-panel';
const CHINESE_FILENAME = '2026-07-24-「維基媒體與-ai-現況」座談';
const ENGLISH_OLD_START = 63866693;
const ENGLISH_OLD_END = 63866850;
const ENGLISH_CURRENT_START = 63868115;
const ENGLISH_CURRENT_END = 63868272;
const ENGLISH_OFFSET = 1422;
const CHINESE_OLD_START = 63867957;
const CHINESE_OLD_END = 63868114;
const CHINESE_CURRENT_START = 63868273;
const CHINESE_CURRENT_END = 63868430;
const CHINESE_OFFSET = 316;
const BOOKEND_CURRENT_ID = 63868133;
const BOOKEND_OLD_ID = 63866711;
const BOOKEND_HTML = '<h2>Bookend II — Audrey Tang: mission, not race</h2>';

type CountRow = { count: number | string };
type HeadingRow = {
	section_id: number | string;
	section_speaker: string | null;
	section_content: string;
};

type RepairState = {
	englishOldCount: number;
	chineseOldCount: number;
	englishCurrentCount: number;
	chineseCurrentCount: number;
	englishTotalCount: number;
	chineseTotalCount: number;
	currentBookend: HeadingRow | null;
	oldBookend: HeadingRow | null;
};

async function countRows(c: Context<ApiEnv>, start: number, end: number, filename?: string): Promise<number> {
	const query = filename
		? c.env.DB.prepare('SELECT COUNT(*) AS count FROM speech_content WHERE filename = ? AND section_id BETWEEN ? AND ?').bind(
				filename,
				start,
				end,
			)
		: c.env.DB.prepare('SELECT COUNT(*) AS count FROM speech_content WHERE section_id BETWEEN ? AND ?').bind(start, end);
	const row = await query.first<CountRow>();
	return Number(row?.count ?? NaN);
}

async function countFilenameRows(c: Context<ApiEnv>, filename: string): Promise<number> {
	const row = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM speech_content WHERE filename = ?').bind(filename).first<CountRow>();
	return Number(row?.count ?? NaN);
}

async function readRepairState(c: Context<ApiEnv>): Promise<RepairState> {
	const [
		englishOldCount,
		chineseOldCount,
		englishCurrentCount,
		chineseCurrentCount,
		englishTotalCount,
		chineseTotalCount,
		currentBookend,
		oldBookend,
	] = await Promise.all([
		countRows(c, ENGLISH_OLD_START, ENGLISH_OLD_END),
		countRows(c, CHINESE_OLD_START, CHINESE_OLD_END),
		countRows(c, ENGLISH_CURRENT_START, ENGLISH_CURRENT_END, ENGLISH_FILENAME),
		countRows(c, CHINESE_CURRENT_START, CHINESE_CURRENT_END, CHINESE_FILENAME),
		countFilenameRows(c, ENGLISH_FILENAME),
		countFilenameRows(c, CHINESE_FILENAME),
		c.env.DB.prepare('SELECT section_id, section_speaker, section_content FROM speech_content WHERE section_id = ?')
			.bind(BOOKEND_CURRENT_ID)
			.first<HeadingRow>(),
		c.env.DB.prepare('SELECT section_id, section_speaker, section_content FROM speech_content WHERE section_id = ?')
			.bind(BOOKEND_OLD_ID)
			.first<HeadingRow>(),
	]);
	return {
		englishOldCount,
		chineseOldCount,
		englishCurrentCount,
		chineseCurrentCount,
		englishTotalCount,
		chineseTotalCount,
		currentBookend,
		oldBookend,
	};
}

function isCurrentState(state: RepairState): boolean {
	const bookend = state.currentBookend;
	return (
		state.englishOldCount === 0 &&
		state.chineseOldCount === 0 &&
		state.englishCurrentCount === 158 &&
		state.chineseCurrentCount === 158 &&
		state.englishTotalCount === 158 &&
		state.chineseTotalCount === 158 &&
		bookend !== null &&
		bookend.section_id === BOOKEND_CURRENT_ID &&
		bookend.section_speaker === null &&
		bookend.section_content.startsWith(BOOKEND_HTML)
	);
}

function isRestoredState(state: RepairState): boolean {
	const bookend = state.oldBookend;
	return (
		state.englishOldCount === 158 &&
		state.chineseOldCount === 158 &&
		state.englishCurrentCount === 0 &&
		state.chineseCurrentCount === 0 &&
		bookend !== null &&
		bookend.section_id === BOOKEND_OLD_ID &&
		state.englishTotalCount === 158 &&
		state.chineseTotalCount === 158 &&
		bookend.section_speaker === null &&
		bookend.section_content.startsWith(BOOKEND_HTML)
	);
}

// Full-file count guards above prove these ranges contain every panel row, so
// no out-of-range row can retain a previous/next pointer into a moved range.
const restoreIdsSql = `
	UPDATE speech_content
	SET
		section_id = CASE
			WHEN filename = '${ENGLISH_FILENAME}' THEN section_id - ${ENGLISH_OFFSET}
			ELSE section_id - ${CHINESE_OFFSET}
		END,
		previous_section_id = CASE
			WHEN previous_section_id BETWEEN ${ENGLISH_CURRENT_START} AND ${ENGLISH_CURRENT_END} THEN previous_section_id - ${ENGLISH_OFFSET}
			WHEN previous_section_id BETWEEN ${CHINESE_CURRENT_START} AND ${CHINESE_CURRENT_END} THEN previous_section_id - ${CHINESE_OFFSET}
			ELSE previous_section_id
		END,
		next_section_id = CASE
			WHEN next_section_id BETWEEN ${ENGLISH_CURRENT_START} AND ${ENGLISH_CURRENT_END} THEN next_section_id - ${ENGLISH_OFFSET}
			WHEN next_section_id BETWEEN ${CHINESE_CURRENT_START} AND ${CHINESE_CURRENT_END} THEN next_section_id - ${CHINESE_OFFSET}
			ELSE next_section_id
		END
	WHERE filename IN ('${ENGLISH_FILENAME}', '${CHINESE_FILENAME}')
		AND section_id BETWEEN ${ENGLISH_CURRENT_START} AND ${CHINESE_CURRENT_END}
`;

/** One-shot, Bearer-authenticated repair for panel IDs replaced by a sync retry. */
export async function repairPanelSectionIds(c: Context<ApiEnv>) {
	const authorized = await isAuthorizedFromHeader(
		c.req.header('Authorization'),
		c.env.AUDREYT_TRANSCRIPT_TOKEN,
		c.env.BESTIAN_TRANSCRIPT_TOKEN,
	);
	if (!authorized) return c.json({ error: 'Forbidden' }, 400);

	try {
		const before = await readRepairState(c);
		if (isRestoredState(before)) return c.json({ success: true, repaired: false, state: before });
		if (!isCurrentState(before)) return c.json({ error: 'Unexpected section-ID state', state: before }, 409);

		await c.env.DB.prepare(restoreIdsSql).run();

		const after = await readRepairState(c);
		if (!isRestoredState(after)) return c.json({ error: 'Section-ID repair verification failed', state: after }, 500);
		return c.json({ success: true, repaired: true, state: after });
	} catch (error) {
		console.error('[repair_panel_section_ids] error', error);
		return c.json({ error: 'Service temporarily unavailable' }, 503);
	}
}
