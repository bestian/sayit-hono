import { describe, expect, it } from 'vitest';
import { getSpeakerDetail, type SpeakerDetailDb } from '../src/db/speaker-detail';

type Row = Record<string, unknown>;

function makeDb(handlers: Array<{ match: (sql: string, args: unknown[]) => boolean; rows: Row[] }>): SpeakerDetailDb {
	return {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T = Row>() {
							for (const handler of handlers) {
								if (handler.match(sql, args)) {
									return (handler.rows[0] as T | undefined) ?? null;
								}
							}
							return null;
						},
					};
				},
			};
		},
	};
}

describe('getSpeakerDetail', () => {
	it('returns null when the speakers base row is missing', async () => {
		const db = makeDb([
			{
				match: (sql) => sql.includes('FROM speakers WHERE route_pathname = ?'),
				rows: [],
			},
		]);
		await expect(getSpeakerDetail(db, 'missing')).resolves.toBeNull();
	});

	it('maps indexed queries to the speakers_view column shape', async () => {
		const calls: string[] = [];
		const db = makeDb([
			{
				match: (sql, args) => {
					if (sql.includes('FROM speakers WHERE route_pathname = ?')) {
						calls.push(`base:${String(args[0])}`);
						return true;
					}
					return false;
				},
				rows: [{ id: 7, route_pathname: 'audrey-tang', name: 'Audrey Tang', photoURL: null }],
			},
			{
				match: (sql, args) => {
					if (sql.includes('WHERE name = ? AND photoURL IS NOT NULL')) {
						calls.push(`photo:${String(args[0])}`);
						return true;
					}
					return false;
				},
				rows: [{ photoURL: '/media/speakers/audrey.jpg' }],
			},
			{
				match: (sql) => sql.includes('COUNT(DISTINCT speech_filename)'),
				rows: [{ count: 4 }],
			},
			{
				match: (sql) => sql.includes('COUNT(*) AS count FROM speech_content'),
				rows: [{ count: 3 }],
			},
			{
				match: (sql) => sql.includes('ORDER BY LENGTH(sc.section_content)'),
				rows: [
					{
						section_id: 100,
						section_content: '<p>long</p>',
						filename: '2026-demo',
						nest_filename: 'nest',
						nest_display_name: 'Nest',
						display_name: 'Demo',
					},
				],
			},
		]);

		const row = await getSpeakerDetail(db, 'audrey-tang');
		expect(calls).toEqual(['base:audrey-tang', 'photo:Audrey Tang']);
		expect(row).toEqual({
			id: 7,
			route_pathname: 'audrey-tang',
			name: 'Audrey Tang',
			photoURL: '/media/speakers/audrey.jpg',
			appearances_count: 4,
			sections_count: 3,
			longest_section_id: 100,
			longest_section_content: '<p>long</p>',
			longest_section_filename: '2026-demo',
			longest_section_nest_filename: 'nest',
			longest_section_nest_display_name: 'Nest',
			longest_section_displayname: 'Demo',
		});
	});

	it('skips photo fallback when base photoURL is present and clamps bad counts', async () => {
		const db = makeDb([
			{
				match: (sql) => sql.includes('FROM speakers WHERE route_pathname = ?'),
				rows: [{ id: 1, route_pathname: 'x', name: 'X', photoURL: '/p.jpg' }],
			},
			{
				match: (sql) => sql.includes('WHERE name = ? AND photoURL IS NOT NULL'),
				rows: [{ photoURL: '/should-not-use.jpg' }],
			},
			{
				match: (sql) => sql.includes('COUNT(DISTINCT speech_filename)'),
				rows: [{ count: 'nope' }],
			},
			{
				match: (sql) => sql.includes('COUNT(*) AS count FROM speech_content'),
				rows: [{ count: -1 }],
			},
			{
				match: (sql) => sql.includes('ORDER BY LENGTH(sc.section_content)'),
				rows: [],
			},
		]);

		const row = await getSpeakerDetail(db, 'x');
		expect(row).toMatchObject({
			photoURL: '/p.jpg',
			appearances_count: 0,
			sections_count: 0,
			longest_section_id: null,
			longest_section_content: null,
			longest_section_filename: null,
			longest_section_nest_filename: null,
			longest_section_nest_display_name: null,
			longest_section_displayname: null,
		});
	});
});
