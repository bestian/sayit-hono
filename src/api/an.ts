import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

const SPEECH_API_PREFIX = '/api/an/';
const SPEECH_FILE_EXTENSION = '.an';
const PERSON_ONTOLOGY_PREFIX = '/ontology/person/13657c62c311/';
const DEFAULT_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

function getSpeechFilename(pathname: string): string | null {
	if (!pathname || pathname === '/') return null;
	if (!pathname.startsWith(SPEECH_API_PREFIX)) return null;

	try {
		const decoded = decodeURIComponent(pathname);
		if (!decoded.endsWith(SPEECH_FILE_EXTENSION)) return null;
		const keyWithExt = decoded.slice(SPEECH_API_PREFIX.length);
		if (!keyWithExt) return null;
		return keyWithExt.slice(0, -SPEECH_FILE_EXTENSION.length);
	} catch {
		return null;
	}
}

function xmlEscape(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function normalizeContent(raw?: string | null): string {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed === 'string') return parsed;
		return raw;
	} catch {
		return raw;
	}
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

type SectionRow = {
	section_id: number;
	section_content: string | null;
	section_speaker: string | null;
	display_name: string | null;
	speaker_name: string | null;
	filename: string;
};

function buildAkomaNtosoXml(
	heading: string,
	persons: Array<{ id: string; showAs: string }>,
	speeches: Array<{ by: string; content: string }>
) {
	const personNodes = persons
		.map(
			(p) =>
				`        <TLCPerson href="${PERSON_ONTOLOGY_PREFIX}${xmlEscape(p.id)}" id="${xmlEscape(p.id)}" showAs="${xmlEscape(p.showAs)}"/>`
		)
		.join('\n');

	const speechNodes = speeches
		.map((s) => {
			const body = (s.content ?? '').trim();
			if (!s.by) {
				return `        <narrative>\n${body}\n        </narrative>`;
			}
			return `        <speech by="#${xmlEscape(s.by)}">\n${body}\n        </speech>`;
		})
		.join('\n\n');

	return `<akomaNtoso>
  <debate>
    <meta>
      <references>
${personNodes}
      </references>
    </meta>
    <debateBody>
      <debateSection>
        <heading>${xmlEscape(heading)}</heading>

${speechNodes}
      </debateSection>
    </debateBody>
  </debate>
</akomaNtoso>`;
}

export async function speechAn(c: Context<ApiEnv>) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);
	const pathname = new URL(c.req.url).pathname;
	const filename = getSpeechFilename(pathname);

	if (!filename) {
		return c.text('Speech not found', 404, corsHeaders);
	}

	if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
		return c.text('Method not allowed', 405, corsHeaders);
	}

	let rows: SectionRow[] = [];
	try {
		const result = await c.env.DB.prepare(
			`SELECT
				sc.section_id,
				sc.section_content,
				sc.section_speaker,
				sc.filename,
				si.display_name,
				sp.name AS speaker_name
			FROM speech_content sc
			LEFT JOIN speech_index si ON sc.filename = si.filename
			LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
			WHERE sc.filename = ?
			ORDER BY sc.section_id ASC`
		)
			.bind(filename)
			.all();

		if (!result.success) {
			throw new Error('Database query failed');
		}
		rows = result.results as SectionRow[];
	} catch (err) {
		console.error('[speech an] DB error', err);
		return c.text('Internal Server Error', 500, corsHeaders);
	}

	if (!rows.length) {
		return c.text('Speech not found', 404, corsHeaders);
	}

	const heading = rows[0]?.display_name ?? filename;
	const personMap = new Map<string, { id: string; showAs: string }>();
	const personOrder: string[] = [];
	for (const row of rows) {
		if (!row.section_speaker) continue;
		const decodedId = safeDecode(row.section_speaker);
		if (!decodedId) continue;
		if (!personMap.has(decodedId)) {
			const showAs = row.speaker_name ? safeDecode(row.speaker_name) : decodedId;
			personMap.set(decodedId, { id: decodedId, showAs });
			personOrder.push(decodedId);
		}
	}

	const speeches = rows.map((row) => {
		const by = row.section_speaker ? safeDecode(row.section_speaker) : '';
		const content = normalizeContent(row.section_content ?? '');
		return { by, content };
	});

	const personsInOrder = personOrder.map((id) => personMap.get(id)!).filter(Boolean);
	const xml = buildAkomaNtosoXml(heading, personsInOrder, speeches);

	const headers = new Headers(corsHeaders);
	headers.set('Content-Type', 'text/xml; charset=utf-8');
	headers.set('Cache-Control', DEFAULT_CACHE_CONTROL);
	const contentLength = new TextEncoder().encode(xml).length;
	headers.set('Content-Length', contentLength.toString());

	if (c.req.method === 'HEAD') {
		return new Response(null, { status: 200, headers });
	}

	return new Response(xml, { status: 200, headers });
}

