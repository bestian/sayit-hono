import initSpeechSpeakers from '../../sql/init-speech_speakers.sql?raw';
import initSpeechContent from '../../sql/init-speech_content.sql?raw';
import fillSpeechContentA from '../../sql/speech/1999年全國司法改革會議.sql?raw';
import fillSpeechContentB from '../../sql/speech/2025-11-10-柏林自由會議ai-的角色.sql?raw';
import initSpeechIndex from '../../sql/init-speech_index.sql?raw';
import fillSpeechIndex from '../../sql/fill-speech_index.sql?raw';
import initSpeakers from '../../sql/init-speakers.sql?raw';
import fillSpeakers from '../../sql/fill-speakers.sql?raw';

type TableSpec = { table: string; init: string; fills: string[] };
const tables: TableSpec[] = [
	{ table: 'speech_speakers', init: initSpeechSpeakers, fills: [] },
	{ table: 'speech_content', init: initSpeechContent, fills: [fillSpeechContentA, fillSpeechContentB] },
	{ table: 'speech_index', init: initSpeechIndex, fills: [fillSpeechIndex] },
	{ table: 'speakers', init: initSpeakers, fills: [fillSpeakers] },
];

let seedPromise: Promise<void> | undefined;
function statements(sql: string): string[] {
	const result: string[] = [];
	let current = '';
	for (const line of sql.split(/\r?\n/)) {
		if (line.trimStart().startsWith('--')) continue;
		current += `${line}\n`;
		let quote: string | undefined;
		let escaped = false;
		for (const character of current) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (quote && character === quote) quote = undefined;
			else if (!quote && (character === "'" || character === '"')) quote = character;
		}
		if (!quote && current.trimEnd().endsWith(';')) {
			result.push(current.trim().replace(/\r?\n/g, ' '));
			current = '';
		}
	}
	if (current.trim()) result.push(current.trim());
	return result;
}

async function execSql(db: D1Database, sql: string): Promise<void> {
	const sqlStatements = statements(sql);
	for (let index = 0; index < sqlStatements.length; index += 75) await db.exec(sqlStatements.slice(index, index + 75).join('\n'));
}
function safeInit(sql: string): string {
	return statements(sql)
		.filter((statement) => !/^DROP TABLE IF EXISTS\b/i.test(statement))
		.join('\n');
}
async function seed(db: D1Database): Promise<void> {
	for (const spec of tables) {
		let count = 0;
		let missing = false;
		const expected = spec.fills.reduce(
			(total, fill) =>
				total +
				statements(fill).filter((statement) => new RegExp(`^INSERT(?: OR IGNORE)? INTO ${spec.table}\\b`, 'i').test(statement)).length,
			0,
		);
		try {
			const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${spec.table}`).first<{ count: number }>();
			count = Number(row?.count ?? 0);
		} catch (error) {
			if (!/no such table|does not exist/i.test(String(error))) throw error;
			missing = true;
			console.log(`[local-d1] ${spec.table}: missing; creating and filling`);
			await execSql(db, safeInit(spec.init));
		}
		if (missing || count < expected) {
			if (!missing) console.log(`[local-d1] ${spec.table}: incomplete (${count}/${expected}); filling`);
			for (const fill of spec.fills) await execSql(db, fill);
		} else console.log(`[local-d1] ${spec.table}: populated (${count}/${expected}); skipping`);
	}
}
export function ensureLocalIndexes(db: D1Database): Promise<void> {
	seedPromise ??= seed(db);
	return seedPromise;
}
