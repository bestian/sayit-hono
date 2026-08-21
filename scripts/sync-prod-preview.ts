import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(import.meta.dirname, '..');
const ORIGIN = 'https://archive.tw';
const PERSIST_DIR = resolve(ROOT, '.wrangler/prod-data-preview');
const D1_DIR = resolve(PERSIST_DIR, 'v3/d1/miniflare-D1DatabaseObject');
const previewLimit = Math.max(4, Math.min(80, Number(process.env.SAYIT_PREVIEW_SPEECHES) || 24));

type SpeechIndexRow = {
	filename: string;
	display_name: string;
	isNested: boolean;
	nest_filenames: string[];
	nest_display_names: string[];
};

type SpeakerRow = {
	id: number;
	route_pathname: string;
	name: string;
	photoURL: string | null;
};

type SpeechSection = {
	filename: string;
	nest_filename: string | null;
	nest_display_name: string | null;
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
};

type ArchiveStats = {
	speeches: number;
	speakers: number;
	sections: number;
};

async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(new URL(path, ORIGIN), {
		headers: { Accept: 'application/json', 'User-Agent': 'sayit-hono-local-preview' },
	});
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${path}`);
	return response.json() as Promise<T>;
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, visit: (item: T) => Promise<R>): Promise<R[]> {
	const output: R[] = [];
	let cursor = 0;

	async function worker() {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			output[index] = await visit(items[index]);
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
	return output;
}

function initializePreviewDatabase(): string {
	rmSync(PERSIST_DIR, { recursive: true, force: true });
	const wrangler = resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js');
	const result = spawnSync(
		process.execPath,
		[
			wrangler,
			'd1',
			'execute',
			'sayit-database',
			'--env',
			'prod-data',
			'--local',
			'--yes',
			'--persist-to',
			PERSIST_DIR,
			'--file',
			resolve(ROOT, 'sql/init-speech_index.sql'),
		],
		{ cwd: ROOT, encoding: 'utf8' },
	);
	if (result.status !== 0) {
		throw new Error(`Could not initialize preview D1:\n${result.stderr || result.stdout}`);
	}
	if (!existsSync(D1_DIR)) throw new Error(`Wrangler did not create ${D1_DIR}`);
	const sqliteFiles = readdirSync(D1_DIR).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
	if (sqliteFiles.length !== 1) throw new Error(`Expected one preview D1 file, found ${sqliteFiles.length}`);
	return resolve(D1_DIR, sqliteFiles[0]);
}

async function main() {
	console.log(`Syncing public production data from ${ORIGIN}…`);
	const [speechIndex, speakers, stats] = await Promise.all([
		fetchJson<SpeechIndexRow[]>('/api/speech_index.json'),
		fetchJson<SpeakerRow[]>('/api/speakers_index.json'),
		fetchJson<ArchiveStats>('/stats.json'),
	]);

	const recentSpeeches = speechIndex
		.filter((speech) => !speech.isNested)
		.sort((a, b) => {
			const dateA = a.filename.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
			const dateB = b.filename.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
			return dateB.localeCompare(dateA) || b.filename.localeCompare(a.filename);
		})
		.slice(0, previewLimit);
	const detailResults = await mapConcurrent(recentSpeeches, 6, async (speech) => {
		try {
			return await fetchJson<SpeechSection[]>(`/api/speech/${encodeURIComponent(speech.filename)}`);
		} catch (error) {
			console.warn(`Skipping ${speech.filename}:`, error instanceof Error ? error.message : error);
			return [];
		}
	});
	const sections = detailResults.flat();
	if (sections.length === 0) throw new Error('Production returned no transcript turns for the preview set.');

	const databasePath = initializePreviewDatabase();
	const database = new DatabaseSync(databasePath);
	try {
		for (const schema of [
			'sql/init-speech_index.sql',
			'sql/init-speech_content.sql',
			'sql/init-speakers.sql',
			'sql/init-speech_speakers.sql',
			'sql/init-section-id-counter.sql',
			'sql/init-speech_redirects.sql',
		]) {
			database.exec(readFileSync(resolve(ROOT, schema), 'utf8'));
		}

		const insertSpeech = database.prepare(
			`INSERT INTO speech_index (filename, display_name, isNested, nest_filenames, nest_display_names)
			 VALUES (?, ?, ?, ?, ?)`,
		);
		const insertSpeaker = database.prepare('INSERT INTO speakers (id, route_pathname, name, photoURL) VALUES (?, ?, ?, ?)');
		const insertSection = database.prepare(
			`INSERT INTO speech_content
			 (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertSpeechSpeaker = database.prepare(
			'INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES (?, ?)',
		);

		database.exec('BEGIN IMMEDIATE');
		try {
			for (const speech of speechIndex) {
				insertSpeech.run(
					speech.filename,
					speech.display_name,
					speech.isNested ? 1 : 0,
					JSON.stringify(speech.nest_filenames ?? []),
					JSON.stringify(speech.nest_display_names ?? []),
				);
			}
			for (const speaker of speakers) {
				insertSpeaker.run(speaker.id, speaker.route_pathname, speaker.name, speaker.photoURL);
			}
			for (const section of sections) {
				insertSection.run(
					section.filename,
					section.nest_filename,
					section.nest_display_name,
					section.section_id,
					section.previous_section_id,
					section.next_section_id,
					section.section_speaker,
					section.section_content,
				);
				if (section.section_speaker) insertSpeechSpeaker.run(section.filename, section.section_speaker);
			}
			database.exec('COMMIT');
		} catch (error) {
			database.exec('ROLLBACK');
			throw error;
		}

		for (const migration of [
			'sql/add-alternate_filename.sql',
			'sql/view_speakers.sql',
			'sql/view_sections.sql',
			'sql/add-speech_content-indexs.sql',
			'sql/add-speakers-name-index.sql',
		]) {
			database.exec(readFileSync(resolve(ROOT, migration), 'utf8'));
		}
	} finally {
		database.close();
	}

	console.log(
		`Production preview ready: ${speechIndex.length.toLocaleString()} conversations, ` +
			`${speakers.length.toLocaleString()} speakers, ${sections.length.toLocaleString()} recent turns ` +
			`(${stats.speeches.toLocaleString()} turns in production).`,
	);
}

await main();
