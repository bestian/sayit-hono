import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

type Section = {
	filename: string;
	nest_filename: string | null;
	nest_display_name: string | null;
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
	display_name: string;
	photoURL: string | null;
	name: string | null;
};

function checkMonotonic(sections: Section[]): boolean {
	if (sections.length <= 1) return true;
	for (let i = 1; i < sections.length; i++) {
		const current = sections[i];
		const previous = sections[i - 1];
		if (current && previous && current.section_id <= previous.section_id) {
			return false;
		}
	}
	return true;
}

function reorderSections(sections: Section[]): Section[] {
	if (sections.length === 0) return [];

	const newArray: Section[] = [];
	const remaining = [...sections];

	let minIndex = 0;
	let minSectionId = remaining[0]?.section_id ?? 0;
	for (let i = 1; i < remaining.length; i++) {
		const current = remaining[i];
		if (current && current.section_id < minSectionId) {
			minSectionId = current.section_id;
			minIndex = i;
		}
	}

	const firstSection = remaining[minIndex];
	if (firstSection) {
		newArray.push(firstSection);
		remaining.splice(minIndex, 1);
	}

	const arrayLength = sections.length;
	for (let i = 0; i < arrayLength - 1; i++) {
		const lastItem = newArray[newArray.length - 1];
		if (!lastItem) break;

		const lastSectionId = lastItem.section_id;
		let found = false;

		for (let j = 0; j < remaining.length; j++) {
			const current = remaining[j];
			if (current && current.previous_section_id === lastSectionId) {
				newArray.push(current);
				remaining.splice(j, 1);
				found = true;
				break;
			}
		}

		if (!found) break;
	}

	return newArray;
}

function normalizeSections(rawData: Section[]): Section[] {
	return checkMonotonic(rawData) ? rawData : reorderSections(rawData);
}

export async function speechContent(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	try {
		const pathname = new URL(c.req.url).pathname;
		const prefix = '/api/speech/';
		const encodedPath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
		const parts = encodedPath.split('/');
		const encodedFilename = parts[0] ?? '';
		const encodedNestFilename = parts.slice(1).join('/') || '';

		if (!encodedFilename) {
			return c.json({ error: 'Invalid filename' }, 400, corsHeaders);
		}

		const filename = decodeURIComponent(encodedFilename);
		const nestFilename = encodedNestFilename ? decodeURIComponent(encodedNestFilename) : null;

		const baseQuery = `
SELECT
	sc.filename,
	sc.nest_filename,
	sc.nest_display_name,
	sc.section_id,
	sc.previous_section_id,
	sc.next_section_id,
	sc.section_speaker,
	sc.section_content,
	si.display_name,
	sp.photoURL,
	sp.name
FROM speech_content sc
LEFT JOIN speech_index si ON sc.filename = si.filename
LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
WHERE sc.filename = ?
${nestFilename ? 'AND sc.nest_filename = ?' : ''}
ORDER BY sc.section_id ASC`;

		const bindings: Array<string> = nestFilename ? [filename, nestFilename] : [filename];

		const result = await c.env.DB.prepare(baseQuery).bind(...bindings).all();

		if (!result.success) {
			return c.json({ error: 'Database query failed' }, 500, corsHeaders);
		}

		const speechRows = normalizeSections(
			result.results.map((row: any) => ({
				filename: row.filename,
				nest_filename: row.nest_filename ?? null,
				nest_display_name: row.nest_display_name ?? row.nest_filename ?? null,
				section_id: row.section_id,
				previous_section_id: row.previous_section_id,
				next_section_id: row.next_section_id,
				section_speaker: row.section_speaker,
				section_content: row.section_content,
				display_name: row.display_name,
				photoURL: row.photoURL,
				name: row.name,
			}))
		);

		if (speechRows.length === 0) {
			return c.json({ error: 'Not Found' }, 404, corsHeaders);
		}

		return c.json(speechRows, 200, corsHeaders);
	} catch (error) {
		console.error('[speech] query failed', error);
		return c.json({ error: 'Internal server error' }, 500, corsHeaders);
	}
}

