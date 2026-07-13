/**
 * Per-speaker detail query that reproduces the speakers_view row shape
 * without scanning the ROW_NUMBER() CTE over all of speech_content.
 *
 * Root cause this replaces: `SELECT * FROM speakers_view WHERE route_pathname = ?`
 * cannot push the predicate into the view's window CTE, so every lookup
 * scanned ~2.18M speech_content rows.
 */

/** Minimal D1 surface used by getSpeakerDetail. */
export interface SpeakerDetailDb {
	prepare(sql: string): {
		bind(...args: unknown[]): {
			first<T = Record<string, unknown>>(): Promise<T | null>;
		};
	};
}

/** Column shape previously exposed by speakers_view for one speaker. */
export type SpeakerDetailRow = {
	id: number;
	route_pathname: string;
	name: string;
	photoURL: string | null;
	appearances_count: number;
	sections_count: number;
	longest_section_id: number | null;
	longest_section_content: string | null;
	longest_section_filename: string | null;
	longest_section_nest_filename: string | null;
	longest_section_nest_display_name: string | null;
	longest_section_displayname: string | null;
};

type BaseSpeakerRow = {
	id: number;
	route_pathname: string;
	name: string;
	photoURL: string | null;
};

type CountRow = { count: number | string | null };

type LongestSectionRow = {
	section_id: number;
	section_content: string | null;
	filename: string | null;
	nest_filename: string | null;
	nest_display_name: string | null;
	display_name: string | null;
};

/**
 * Load one speaker's speakers_view-equivalent row via indexed per-speaker queries.
 * Returns null when no speakers row matches route_pathname.
 */
export async function getSpeakerDetail(db: SpeakerDetailDb, routePathname: string): Promise<SpeakerDetailRow | null> {
	const base = await db
		.prepare('SELECT id, route_pathname, name, photoURL FROM speakers WHERE route_pathname = ?')
		.bind(routePathname)
		.first<BaseSpeakerRow>();

	if (!base) return null;

	let photoURL = base.photoURL ?? null;
	if (photoURL == null) {
		const fallback = await db
			.prepare(
				`SELECT photoURL FROM speakers
				WHERE name = ? AND photoURL IS NOT NULL
				ORDER BY id ASC LIMIT 1`,
			)
			.bind(base.name)
			.first<{ photoURL: string | null }>();
		photoURL = fallback?.photoURL ?? null;
	}

	// Parallel indexed aggregates + longest section (section_id is PK so COUNT(*)
	// is equivalent to COUNT(DISTINCT section_id) on speech_content).
	const [appearancesRow, sectionsRow, longest] = await Promise.all([
		db
			.prepare('SELECT COUNT(DISTINCT speech_filename) AS count FROM speech_speakers WHERE speaker_route_pathname = ?')
			.bind(routePathname)
			.first<CountRow>(),
		db
			.prepare('SELECT COUNT(*) AS count FROM speech_content WHERE section_speaker = ?')
			.bind(routePathname)
			.first<CountRow>(),
		db
			.prepare(
				`SELECT sc.section_id, sc.section_content, sc.filename, sc.nest_filename, sc.nest_display_name, si.display_name
				FROM speech_content sc
				LEFT JOIN speech_index si ON sc.filename = si.filename
				WHERE sc.section_speaker = ?
					AND sc.section_content IS NOT NULL
					AND sc.section_content != ''
				ORDER BY LENGTH(sc.section_content) DESC, sc.section_id ASC
				LIMIT 1`,
			)
			.bind(routePathname)
			.first<LongestSectionRow>(),
	]);

	const appearancesRaw = Number(appearancesRow?.count ?? 0);
	const sectionsRaw = Number(sectionsRow?.count ?? 0);

	return {
		id: base.id,
		route_pathname: base.route_pathname,
		name: base.name,
		photoURL,
		appearances_count: Number.isFinite(appearancesRaw) && appearancesRaw >= 0 ? appearancesRaw : 0,
		sections_count: Number.isFinite(sectionsRaw) && sectionsRaw >= 0 ? sectionsRaw : 0,
		longest_section_id: longest?.section_id ?? null,
		longest_section_content: longest?.section_content ?? null,
		longest_section_filename: longest?.filename ?? null,
		longest_section_nest_filename: longest?.nest_filename ?? null,
		longest_section_nest_display_name: longest?.nest_display_name ?? null,
		longest_section_displayname: longest?.display_name ?? null,
	};
}
