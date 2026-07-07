/**
 * Lanyang speech OG layout (蘭陽黑體 headline · 蘭陽明體 chrome).
 * Fonts read from ~/Library/Fonts only — for licensed-device bake, not Workers.
 */
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { readFileSync } from 'fs';
import { join } from 'path';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const FONT_DIR = join(process.env.HOME ?? '', 'Library', 'Fonts');

const FONT_MING_REGULAR = 'jf-lanyangming-2.0-regular.otf';
const FONT_MING_MEDIUM = 'jf-lanyangming-2.0-medium.otf';
const FONT_HEI_W8 = 'jf-lanyanghei-1.0-w8.otf';
const FONT_HEI_W10 = 'jf-lanyanghei-1.0-w10.otf';

const FAMILY_MING = 'jf-lanyangming';
const FAMILY_HEI = 'jf-lanyanghei';

export type SatoriElement = Parameters<typeof satori>[0];

let resvgReady = false;

function readFontFile(filename: string): ArrayBuffer {
	const buf = readFileSync(join(FONT_DIR, filename));
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export function lanyangFontsInstalled(): boolean {
	try {
		readFontFile(FONT_MING_REGULAR);
		readFontFile(FONT_HEI_W10);
		return true;
	} catch {
		return false;
	}
}

export function extractDateFromFilename(filename: string): string | null {
	return filename.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

/** Match upload_markdown transformFilename for .md paths */
export function slugFromMarkdownPath(relativeMd: string): string {
	const lower = relativeMd.toLowerCase();
	const replaced = lower.replace(/\.md$/, '').replace(/：/g, '-');
	return replaced.slice(0, 50);
}

export function titleFromDisplayName(displayName: string, date: string | null): string {
	let title = displayName;
	if (date) title = title.replace(new RegExp(`^${date}[-\\s]*`), '');
	return title.replace(/^[\s\u00a0]+/, '').trim();
}

function backgroundLayers(): SatoriElement[] {
	return [
		{
			type: 'div',
			props: {
				style: {
					position: 'absolute',
					top: '-250px',
					left: '-100px',
					width: '800px',
					height: '800px',
					borderRadius: '50%',
					background: 'radial-gradient(circle, rgba(219,165,75,0.04) 0%, transparent 65%)',
				},
			},
		},
		{
			type: 'div',
			props: {
				style: {
					position: 'absolute',
					bottom: '-200px',
					right: '-150px',
					width: '700px',
					height: '700px',
					borderRadius: '50%',
					background: 'radial-gradient(circle, rgba(210,105,72,0.045) 0%, transparent 65%)',
				},
			},
		},
		{
			type: 'div',
			props: {
				style: {
					position: 'absolute',
					bottom: '-570px',
					left: '-10px',
					width: '1220px',
					height: '980px',
					borderRadius: '50%',
					border: '50px solid rgba(219,159,66,0.02)',
				},
			},
		},
		{
			type: 'div',
			props: {
				style: {
					position: 'absolute',
					bottom: '-520px',
					left: '50px',
					width: '1100px',
					height: '900px',
					borderRadius: '50%',
					border: '1.5px solid rgba(212,164,74,0.32)',
				},
			},
		},
		{
			type: 'div',
			props: {
				style: {
					position: 'absolute',
					bottom: '-680px',
					left: '-80px',
					width: '1360px',
					height: '1100px',
					borderRadius: '50%',
					border: '1px solid rgba(212,164,74,0.1)',
				},
			},
		},
		{
			type: 'div',
			props: {
				style: {
					position: 'absolute',
					bottom: '-840px',
					left: '-210px',
					width: '1620px',
					height: '1300px',
					borderRadius: '50%',
					border: '1px solid rgba(212,164,74,0.05)',
				},
			},
		},
	];
}

export function buildLanyangSpeechElement(
	title: string,
	date: string | null,
	speakers: string[]
): SatoriElement {
	const speakerText = speakers.length > 0 ? speakers.join(' · ') : '';
	const fontSize = title.length > 20 ? (title.length > 35 ? 48 : 56) : 72;

	const footerChildren: SatoriElement[] = [];
	if (date) {
		footerChildren.push({
			type: 'span',
			props: {
				style: { fontSize: 22, color: '#d4a44a', fontWeight: 500, fontFamily: FAMILY_MING },
				children: date,
			},
		});
	}
	if (speakerText) {
		footerChildren.push({
			type: 'span',
			props: {
				style: {
					fontSize: 28,
					color: 'rgba(245,240,232,0.78)',
					fontWeight: 500,
					fontFamily: FAMILY_MING,
					letterSpacing: '0.5px',
				},
				children: speakerText,
			},
		});
	}

	return {
		type: 'div',
		props: {
			style: {
				display: 'flex',
				flexDirection: 'column',
				width: '100%',
				height: '100%',
				padding: '80px',
				background: '#0f1729',
				fontFamily: FAMILY_HEI,
				color: '#f5f0e8',
				position: 'relative',
				overflow: 'hidden',
			},
			children: [
				...backgroundLayers(),
				{
					type: 'span',
					props: {
						style: {
							fontSize: 16,
							fontWeight: 500,
							fontFamily: FAMILY_MING,
							color: 'rgba(245,240,232,0.38)',
							letterSpacing: '4px',
						},
						children: 'ARCHIVE.TW',
					},
				},
				{
					type: 'div',
					props: {
						style: { display: 'flex', flex: 1, alignItems: 'center' },
						children: {
							type: 'span',
							props: {
								style: {
									fontSize,
									fontWeight: 920,
									fontFamily: FAMILY_HEI,
									lineHeight: 1.2,
									color: '#f5f0e8',
								},
								children: title,
							},
						},
					},
				},
				{
					type: 'div',
					props: {
						style: { display: 'flex', flexDirection: 'column', gap: '6px' },
						children: footerChildren,
					},
				},
			],
		},
	};
}

export async function renderLanyangSpeechPng(
	filename: string,
	displayName: string,
	speakers: string[]
): Promise<Uint8Array> {
	const date = extractDateFromFilename(filename);
	const title = titleFromDisplayName(displayName, date);
	const element = buildLanyangSpeechElement(title, date, speakers);

	const mingRegular = readFontFile(FONT_MING_REGULAR);
	const mingMedium = readFontFile(FONT_MING_MEDIUM);
	const heiW8 = readFontFile(FONT_HEI_W8);
	const heiW10 = readFontFile(FONT_HEI_W10);

	const svg = await satori(element, {
		width: OG_WIDTH,
		height: OG_HEIGHT,
		fonts: [
			{ name: FAMILY_MING, data: mingRegular, weight: 400, style: 'normal' },
			{ name: FAMILY_MING, data: mingMedium, weight: 500, style: 'normal' },
			{ name: FAMILY_HEI, data: heiW8, weight: 800, style: 'normal' },
			{ name: FAMILY_HEI, data: heiW10, weight: 920, style: 'normal' },
		],
	});

	if (!resvgReady) {
		const wasmPath = join(import.meta.dirname, '..', 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
		try {
			await initWasm(readFileSync(wasmPath));
		} catch {
			// already initialized
		}
		resvgReady = true;
	}

	return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}