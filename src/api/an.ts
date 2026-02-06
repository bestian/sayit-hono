import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

const SPEECH_API_PREFIX = '/api/an/';
const SPEECH_FILE_EXTENSION = '.an';
const PERSON_ONTOLOGY_PREFIX = '/ontology/person/13657c62c311/';
const DEFAULT_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

/** 判斷 key 是否為純數字（section_id），如 "629603.an" -> true */
function isNumericAnKey(key: string): boolean {
	const base = key.endsWith(SPEECH_FILE_EXTENSION) ? key.slice(0, -SPEECH_FILE_EXTENSION.length) : key;
	return /^\d+$/.test(base);
}

function parseContent(raw: string | null | undefined): string {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'string' ? parsed : raw;
	} catch {
		return raw;
	}
}

/** 僅跳脫未轉義的 & 為 &amp;，確保 XML 合法（不破壞既有實體） */
function escapeAmp(s: string): string {
	return s.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
}

/** 從多個 section 生成完整演講的 .an */
function generateFullSpeechAn(sections: Array<{
	section_speaker: string | null;
	section_content: string | null;
	display_name: string | null;
	name: string | null;
}>): string {
	if (sections.length === 0) return '';

	const heading = sections[0]?.display_name ? escapeXml(sections[0].display_name) : '';
	const seenSpeakers = new Map<string, string>();
	for (const s of sections) {
		const id = s.section_speaker ?? 'unknown';
		if (!seenSpeakers.has(id)) {
			seenSpeakers.set(id, s.name ?? s.section_speaker ?? 'Unknown');
		}
	}
	const tlcPersons = Array.from(seenSpeakers.entries())
		.map(
			([id, showAs]) =>
				`        <TLCPerson href="/ontology/person/13657c62c311/${escapeXml(id)}" id="${escapeXml(id)}" showAs="${escapeXml(showAs)}"/>`
		)
		.join('\n');

	const speechBlocks = sections.map((s) => {
		const speakerId = s.section_speaker ?? 'unknown';
		const content = parseContent(s.section_content ?? '');
		const bodyContent = content.trim().startsWith('<')
			? escapeAmp(content)
			: `<p>${escapeXml(content)}</p>`;
		return `            <speech by="#${escapeXml(speakerId)}">



              ${bodyContent}
            </speech>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso>
  <debate>
    <meta>
      <references>

${tlcPersons}
      </references>
    </meta>
    <debateBody>
      <debateSection>

        <heading>${heading}</heading>





${speechBlocks.join('\n\n\n\n\n\n\n\n\n\n')}

      </debateSection>
    </debateBody>
  </debate>
</akomaNtoso>
`;
}

/** 從 section 資料生成單一 section 的 .an（不依賴 R2） */
function generateSingleSectionAn(section: {
	section_speaker: string | null;
	section_content: string | null;
	display_name: string | null;
	name: string | null;
}): string {
	const speakerId = section.section_speaker ?? 'unknown';
	const showAs = section.name ?? section.section_speaker ?? 'Unknown';
	const content = parseContent(section.section_content ?? '');
	const bodyContent = content.trim().startsWith('<')
		? escapeAmp(content)
		: `<p>${escapeXml(content)}</p>`;
	const heading = section.display_name ? escapeXml(section.display_name) : '';

	const tlcPerson = `<TLCPerson href="/ontology/person/13657c62c311/${escapeXml(speakerId)}" id="${escapeXml(speakerId)}" showAs="${escapeXml(showAs)}"/>`;

	return `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso>
  <debate>
    <meta>
      <references>
        ${tlcPerson}
      </references>
    </meta>
    <debateBody>
      <debateSection>

        <heading>${heading}</heading>




            <speech by="#${escapeXml(speakerId)}">



              ${bodyContent}
            </speech>

      </debateSection>
    </debateBody>
  </debate>
</akomaNtoso>
`;
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

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

/** 從 path 解析出 .an 的 object key（含副檔名），供 speechAn 使用 */
function getSpeechObjectKey(path: string): string | null {
	if (!path || path === '/') return null;
	if (!path.startsWith(SPEECH_API_PREFIX)) return null;
	try {
		const decoded = decodeURIComponent(path);
		const key = decoded.slice(SPEECH_API_PREFIX.length);
		if (!key || !key.endsWith(SPEECH_FILE_EXTENSION)) return null;
		return key;
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

function sanitizeHtmlForXml(html: string): string {
	// XML 不支援 &nbsp;，轉成數值實體；保留其他標籤與已合法的實體
	return html.replace(/&(nbsp|#160);/gi, '&#160;');
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

function buildSpeechHeaders(corsHeaders: Record<string, string>, r2Object: R2Object): Headers {
	const headers = new Headers(corsHeaders);
	r2Object.writeHttpMetadata(headers);
	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'text/plain; charset=utf-8');
	}
	if (!headers.has('Cache-Control')) {
		headers.set('Cache-Control', DEFAULT_CACHE_CONTROL);
	}
	return headers;
}

/** 依 R2 object key 提供 .an 檔案，供 /api/an/* 與 /speech/:id.an 共用
 * - 若 key 為純數字（如 629603.an）：從 DB 查 section，即時生成該 section 的 .an
 * - 否則：從 R2 取得或從 DB 即時生成完整演講的 .an
 */
export async function serveAnByKey(c: Context<ApiEnv>, objectKey: string) {
	const origin = c.req.header('Origin') ?? null;
	const corsHeaders = getCorsHeaders(origin);

	if (!objectKey || !objectKey.endsWith(SPEECH_FILE_EXTENSION)) {
		return c.text('Speech not found', 404, corsHeaders);
	}

	if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
		return c.text('Method not allowed', 405, corsHeaders);
	}

	const baseKey = objectKey.slice(0, -SPEECH_FILE_EXTENSION.length);

	if (isNumericAnKey(objectKey)) {
		// 單一 section：從 DB 查 section 資料，即時生成 .an（不依賴 R2）
		const sectionId = parseInt(baseKey, 10);
		const sectionRow = await c.env.DB.prepare(
			'SELECT section_speaker, section_content, display_name, name FROM sections WHERE section_id = ?'
		)
			.bind(sectionId)
			.first();

		if (!sectionRow) {
			return c.text('Speech not found', 404, corsHeaders);
		}

		const section = sectionRow as {
			section_speaker: string | null;
			section_content: string | null;
			display_name: string | null;
			name: string | null;
		};
		const singleAn = generateSingleSectionAn(section);

		const headers = new Headers(corsHeaders);
		headers.set('Content-Type', 'text/plain; charset=utf-8');
		headers.set('Cache-Control', 'public, max-age=3600');

		if (c.req.method === 'HEAD') {
			headers.set('Content-Length', new TextEncoder().encode(singleAn).length.toString());
			return new Response(null, { status: 200, headers });
		}
		return new Response(singleAn, { status: 200, headers });
	}

	// 完整演講：先從 R2 取得（若 decoded key 無結果，嘗試 encoded key）
	const tryR2Key = (key: string) =>
		c.req.method === 'HEAD' ? c.env.SPEECH_AN.head(key) : c.env.SPEECH_AN.get(key);

	let r2Object = await tryR2Key(objectKey);
	if (!r2Object && objectKey !== encodeURIComponent(objectKey)) {
		r2Object = await tryR2Key(encodeURIComponent(objectKey));
	}

	if (r2Object) {
		const headers = buildSpeechHeaders(corsHeaders, r2Object as R2Object);
		if (c.req.method === 'HEAD') {
			return new Response(null, { status: 200, headers });
		}
		return new Response((r2Object as R2ObjectBody).body, { status: 200, headers });
	}

	// R2 沒有：從 DB 查 speech_content 即時生成 .an
	const result = await c.env.DB.prepare(
		`SELECT sc.section_speaker, sc.section_content, si.display_name, sp.name
		 FROM speech_content sc
		 LEFT JOIN speech_index si ON sc.filename = si.filename
		 LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
		 WHERE sc.filename = ?
		 ORDER BY sc.section_id ASC`
	)
		.bind(baseKey)
		.all();

	if (!result.success || (result.results as unknown[]).length === 0) {
		return c.text('Speech not found', 404, corsHeaders);
	}

	const sections = (result.results as Array<{
		section_speaker: string | null;
		section_content: string | null;
		display_name: string | null;
		name: string | null;
	}>).map((r) => ({
		section_speaker: r.section_speaker,
		section_content: r.section_content,
		display_name: r.display_name,
		name: r.name
	}));

	const generatedAn = generateFullSpeechAn(sections);

	const headers = new Headers(corsHeaders);
	headers.set('Content-Type', 'text/plain; charset=utf-8');
	headers.set('Cache-Control', 'public, max-age=3600');

	if (c.req.method === 'HEAD') {
		headers.set('Content-Length', new TextEncoder().encode(generatedAn).length.toString());
		return new Response(null, { status: 200, headers });
	}
	return new Response(generatedAn, { status: 200, headers });
}

/** 取得 .an 內容字串，供 md 等轉換使用。objectKey 格式同 serveAnByKey（如 629603.an 或 filename.an） */
export async function getAnContentAsString(c: Context<ApiEnv>, objectKey: string): Promise<string | null> {
	if (!objectKey || !objectKey.endsWith(SPEECH_FILE_EXTENSION)) return null;
	const baseKey = objectKey.slice(0, -SPEECH_FILE_EXTENSION.length);

	if (isNumericAnKey(objectKey)) {
		const sectionId = parseInt(baseKey, 10);
		const sectionRow = await c.env.DB.prepare(
			'SELECT section_speaker, section_content, display_name, name FROM sections WHERE section_id = ?'
		)
			.bind(sectionId)
			.first();
		if (!sectionRow) return null;
		const section = sectionRow as {
			section_speaker: string | null;
			section_content: string | null;
			display_name: string | null;
			name: string | null;
		};
		return generateSingleSectionAn(section);
	}

	const tryR2Key = (key: string) => c.env.SPEECH_AN.get(key);
	let r2Object = await tryR2Key(objectKey);
	if (!r2Object && objectKey !== encodeURIComponent(objectKey)) {
		r2Object = await tryR2Key(encodeURIComponent(objectKey));
	}
	if (r2Object) {
		return (r2Object as R2ObjectBody).text();
	}

	const filename = baseKey;
	const result = await c.env.DB.prepare(
		`SELECT sc.section_speaker, sc.section_content, si.display_name, sp.name
		 FROM speech_content sc
		 LEFT JOIN speech_index si ON sc.filename = si.filename
		 LEFT JOIN speakers sp ON sc.section_speaker = sp.route_pathname
		 WHERE sc.filename = ?
		 ORDER BY sc.section_id ASC`
	)
		.bind(filename)
		.all();
	if (!result.success || (result.results as unknown[]).length === 0) return null;
	const sections = (result.results as Array<{
		section_speaker: string | null;
		section_content: string | null;
		display_name: string | null;
		name: string | null;
	}>).map((r) => ({
		section_speaker: r.section_speaker,
		section_content: r.section_content,
		display_name: r.display_name,
		name: r.name
	}));
	return generateFullSpeechAn(sections);
}

export async function speechAn(c: Context<ApiEnv>) {
	// 優先使用 route param（/api/an/:path{...}），否則從 pathname 解析
	const pathParam = c.req.param('path');
	let speechObjectKey: string | null =
		pathParam && pathParam.endsWith(SPEECH_FILE_EXTENSION)
			? pathParam
			: getSpeechObjectKey(c.req.path);
	if (speechObjectKey) {
		try {
			speechObjectKey = decodeURIComponent(speechObjectKey);
		} catch {
			// 保持原樣
		}
	}
	if (!speechObjectKey) {
		const origin = c.req.header('Origin') ?? null;
		return c.text('Speech not found', 404, getCorsHeaders(origin));
	}
	return serveAnByKey(c, speechObjectKey);
}

