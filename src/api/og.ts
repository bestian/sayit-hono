import satori, { init as initSatori } from 'satori/standalone';
import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
// @ts-ignore — wrangler resolves .wasm imports to WebAssembly.Module
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-ignore — wrangler resolves .wasm imports to WebAssembly.Module
import yogaWasm from 'satori/yoga.wasm';

let wasmInitPromise: Promise<void> | null = null;

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

async function ensureWasm() {
	if (!wasmInitPromise) {
		wasmInitPromise = Promise.all([
			initSatori(yogaWasm),
			initResvg(resvgWasm),
		]).then(() => undefined).catch((error) => {
			wasmInitPromise = null;
			throw error;
		});
	}
	await wasmInitPromise;
}

async function fetchFont(text: string, weight: number): Promise<ArrayBuffer> {
	const chars = [...new Set(text)].join('');
	const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@${weight}&text=${encodeURIComponent(chars)}`;
	const css = await fetch(url).then((r) => r.text());
	const fontUrl = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
	if (!fontUrl) throw new Error('Font URL not found in Google Fonts CSS');
	return fetch(fontUrl).then((r) => r.arrayBuffer());
}

function extractDate(filename: string): string | null {
	return filename.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}


function avatarElement(dataUri: string, size: number) {
	const ring = size + 6;
	return {
		type: 'div',
		props: {
			style: {
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: `${ring}px`,
				height: `${ring}px`,
				borderRadius: '50%',
				background: '#d4a44a',
				flexShrink: 0,
			},
			children: {
				type: 'img',
				props: {
					src: dataUri,
					width: size,
					height: size,
					style: {
						width: `${size}px`,
						height: `${size}px`,
						borderRadius: '50%',
					},
				},
			},
		},
	};
}

// Shared background layers: arc, rings, ambient light
function backgroundLayers() {
	return [
		// Ambient saffron light (upper-left)
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
		// Coral light source (lower-right)
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
		// Arc glow ring
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
		// Main arc line
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
		// Concentric ring 1
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
		// Concentric ring 2
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

function buildSpeechElement(title: string, date: string | null, speakers: string[]) {
	const speakerText = speakers.length > 0 ? speakers.join(' \u00b7 ') : '';
	const fontSize = title.length > 20 ? (title.length > 35 ? 48 : 56) : 72;

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
				fontFamily: 'Noto Sans TC',
				color: '#f5f0e8',
				position: 'relative',
				overflow: 'hidden',
			},
			children: [
				...backgroundLayers(),
				// Eyebrow
				{
					type: 'span',
					props: {
						style: { fontSize: 16, fontWeight: 400, color: 'rgba(245,240,232,0.38)', letterSpacing: '4px' },
						children: 'ARCHIVE.TW',
					},
				},
				// Headline
				{
					type: 'div',
					props: {
						style: { display: 'flex', flex: 1, alignItems: 'center' },
						children: {
							type: 'span',
							props: {
								style: { fontSize, fontWeight: 700, lineHeight: 1.2, color: '#f5f0e8' },
								children: title,
							},
						},
					},
				},
				// Date + speakers
				{
					type: 'div',
					props: {
						style: { display: 'flex', flexDirection: 'column', gap: '6px' },
						children: [
							date
								? { type: 'span', props: { style: { fontSize: 22, color: '#d4a44a', fontWeight: 400 }, children: date } }
								: null,
							speakerText
								? {
										type: 'span',
										props: {
											style: { fontSize: 18, color: 'rgba(245,240,232,0.35)', fontWeight: 400, letterSpacing: '1px' },
											children: speakerText,
										},
									}
								: null,
						].filter(Boolean),
					},
				},
			],
		},
	};
}

function buildQuoteElement(
	quoteText: string,
	speakerName: string | null,
	speechTitle: string,
	avatarDataUri: string | null
) {
	const maxLen = 300;
	const displayQuote = truncate(quoteText, maxLen);
	const len = displayQuote.length;
	const fontSize = len > 200 ? 32 : len > 150 ? 36 : len > 80 ? 42 : len > 50 ? 50 : len > 30 ? 58 : len > 15 ? 72 : len > 6 ? 88 : 104;

	return {
		type: 'div',
		props: {
			style: {
				display: 'flex',
				flexDirection: 'column',
				width: '100%',
				height: '100%',
				padding: '60px 72px 72px',
				background: '#0f1729',
				fontFamily: 'Noto Sans TC',
				color: '#f5f0e8',
				position: 'relative',
				overflow: 'hidden',
			},
			children: [
				...backgroundLayers(),
				// Quote text
				{
					type: 'div',
					props: {
						style: { display: 'flex', flex: 1, alignItems: 'flex-start' },
						children: {
							type: 'span',
							props: {
								style: { fontSize, fontWeight: 500, lineHeight: 1.55, color: '#f5f0e8', letterSpacing: fontSize <= 36 ? '0.03em' : undefined },
								children: displayQuote,
							},
						},
					},
				},
				// Attribution + context
				{
					type: 'div',
					props: {
						style: { display: 'flex', alignItems: 'center', gap: '16px' },
						children: [
							avatarDataUri ? avatarElement(avatarDataUri, 52) : null,
							{
								type: 'div',
								props: {
									style: { display: 'flex', flexDirection: 'column', gap: '4px' },
									children: [
										speakerName
											? {
													type: 'span',
													props: {
														style: { fontSize: 22, color: '#d4a44a', fontWeight: 400 },
														children: avatarDataUri ? speakerName : `\u2014 ${speakerName}`,
													},
												}
											: null,
										{
											type: 'span',
											props: {
												style: { fontSize: 16, color: 'rgba(245,240,232,0.3)', fontWeight: 400, letterSpacing: '0.5px' },
												children: speechTitle,
											},
										},
									].filter(Boolean),
								},
							},
						].filter(Boolean),
					},
				},
			],
		},
	};
}

async function renderElement(element: any, allText: string, fontWeights: number[] = [400, 700]): Promise<Uint8Array> {
	await ensureWasm();

	const fontBuffers = await Promise.all(fontWeights.map((w) => fetchFont(allText, w)));

	const svg = await satori(element as any, {
		width: OG_WIDTH,
		height: OG_HEIGHT,
		fonts: fontBuffers.map((data, i) => ({
			name: 'Noto Sans TC',
			data,
			weight: fontWeights[i] as 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900,
			style: 'normal' as const,
		})),
	});

	const resvg = new Resvg(svg, {
		fitTo: { mode: 'width' as const, value: OG_WIDTH },
	});
	return resvg.render().asPng();
}

export async function generateOgImage(
	_env: { ASSETS: Fetcher },
	filename: string,
	displayName: string,
	speakers: string[]
): Promise<Uint8Array> {
	const date = extractDate(filename);
	let title = displayName || filename;
	// Strip date prefix from title if it's shown separately
	if (date) title = title.replace(new RegExp(`^${date}[-\\s]*`), '');
	const speakerText = speakers.join(' \u00b7 ');
	const allText = ['ARCHIVE.TW', title, date ?? '', '\u00b7', ...speakers].join('');
	const element = buildSpeechElement(title, date, speakers);
	return renderElement(element, allText);
}

export async function generateQuoteOgImage(
	quoteHtml: string,
	speakerName: string | null,
	speechTitle: string,
	avatarDataUri: string | null = null
): Promise<Uint8Array> {
	const plainText = quoteHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
	const displayQuote = truncate(plainText, 300);
	const allText = ['ARCHIVE.TW', displayQuote, speakerName ?? '', speechTitle, '\u2014'].join('');
	const element = buildQuoteElement(plainText, speakerName, speechTitle, avatarDataUri);
	return renderElement(element, allText, [400, 500]);
}
