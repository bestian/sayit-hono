import type { Context } from 'hono';
import { getCorsHeaders } from './cors';
import type { ApiEnv } from './types';

const SPEECH_API_PREFIX = '/api/an/';
const SPEECH_FILE_EXTENSION = '.an';

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

function getSpeechObjectKey(pathname: string): string | null {
	if (!pathname || pathname === '/') {
		return null;
	}

	if (!pathname.startsWith(SPEECH_API_PREFIX)) {
		return null;
	}

	try {
		const decoded = decodeURIComponent(pathname);
		if (!decoded.endsWith(SPEECH_FILE_EXTENSION)) {
			return null;
		}

		const key = decoded.slice(SPEECH_API_PREFIX.length);
		return key.length > 0 ? key : null;
	} catch {
		return null;
	}
}

function buildSpeechHeaders(baseHeaders: Record<string, string>, object: R2Object | R2ObjectBody) {
	const headers = new Headers(baseHeaders);
	const fallbackContentType = 'text/plain; charset=utf-8';
	const fallbackCacheControl = 'public, max-age=3600';

	headers.set('Cache-Control', object.httpMetadata?.cacheControl ?? fallbackCacheControl);
	headers.set('Content-Type', object.httpMetadata?.contentType ?? fallbackContentType);

	if (typeof object.size === 'number') {
		headers.set('Content-Length', object.size.toString());
	}

	if (object.httpEtag) {
		headers.set('ETag', object.httpEtag);
	}

	return headers;
}

/** 依 R2 object key 提供 .an 檔案，供 /api/an/* 與 /speech/:id.an 共用
 * - 若 key 為純數字（如 629603.an）：從 DB 查 section，即時生成該 section 的 .an
 * - 否則：直接從 R2 取得完整演講的 .an
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

	// 完整演講：直接從 R2 取得（若 decoded key 無結果，嘗試 encoded key）
	const tryR2Key = (key: string) =>
		c.req.method === 'HEAD' ? c.env.SPEECH_AN.head(key) : c.env.SPEECH_AN.get(key);

	let r2Object = await tryR2Key(objectKey);
	if (!r2Object && objectKey !== encodeURIComponent(objectKey)) {
		r2Object = await tryR2Key(encodeURIComponent(objectKey));
	}

	if (!r2Object) {
		// R2 沒有：從 DB 查 speech_content 即時生成 .an
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

	if (c.req.method === 'HEAD') {
		return new Response(null, {
			status: 200,
			headers: buildSpeechHeaders(corsHeaders, r2Object as R2Object),
		});
	}

	return new Response((r2Object as R2ObjectBody).body, {
		status: 200,
		headers: buildSpeechHeaders(corsHeaders, r2Object as R2ObjectBody),
	});
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

