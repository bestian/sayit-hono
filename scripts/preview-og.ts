import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

async function fetchFont(text: string, weight: number): Promise<ArrayBuffer> {
	const chars = [...new Set(text)].join('');
	const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@${weight}&text=${encodeURIComponent(chars)}`;
	const css = await fetch(url).then((r) => r.text());
	const fontUrl = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
	if (!fontUrl) throw new Error(`Font URL not found for weight ${weight}`);
	return fetch(fontUrl).then((r) => r.arrayBuffer());
}

function buildElement(title: string, date: string | null, speakers: string[]) {
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
							background:
								'radial-gradient(circle, rgba(219,165,75,0.04) 0%, transparent 65%)',
						},
					},
				},

				// Coral light source (lower-right, warms the right side of the arc)
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
							background:
								'radial-gradient(circle, rgba(210,105,72,0.045) 0%, transparent 65%)',
						},
					},
				},

				// Arc glow ring (hollow glow around the arc path)
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

				// Eyebrow
				{
					type: 'span',
					props: {
						style: {
							fontSize: 16,
							fontWeight: 400,
							color: 'rgba(245,240,232,0.38)',
							letterSpacing: '4px',
						},
						children: 'SAYIT ARCHIVE',
					},
				},

				// Headline (centered vertically in remaining space)
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							flex: 1,
							alignItems: 'center',
						},
						children: {
							type: 'span',
							props: {
								style: {
									fontSize,
									fontWeight: 700,
									lineHeight: 1.2,
									color: '#f5f0e8',
								},
								children: title,
							},
						},
					},
				},

				// Date + speakers
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							flexDirection: 'column',
							gap: '6px',
						},
						children: [
							date
								? {
										type: 'span',
										props: {
											style: {
												fontSize: 22,
												color: '#d4a44a',
												fontWeight: 400,
											},
											children: date,
										},
									}
								: null,
							speakerText
								? {
										type: 'span',
										props: {
											style: {
												fontSize: 18,
												color: 'rgba(245,240,232,0.35)',
												fontWeight: 400,
												letterSpacing: '1px',
											},
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

function buildQuoteElement(quoteText: string, speakerName: string | null, speechTitle: string) {
	const maxLen = 120;
	const displayQuote = quoteText.length > maxLen ? quoteText.slice(0, maxLen).replace(/\s+\S*$/, '') + '\u2026' : quoteText;
	const fontSize = displayQuote.length > 80 ? 32 : displayQuote.length > 50 ? 38 : 44;

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
				...bgLayers(),
				// Eyebrow
				{
					type: 'span',
					props: {
						style: { fontSize: 16, fontWeight: 400, color: 'rgba(245,240,232,0.38)', letterSpacing: '4px' },
						children: 'SAYIT ARCHIVE',
					},
				},
				// Quote text
				{
					type: 'div',
					props: {
						style: { display: 'flex', flex: 1, alignItems: 'center', paddingRight: '40px' },
						children: {
							type: 'span',
							props: {
								style: { fontSize, fontWeight: 400, lineHeight: 1.55, color: '#f5f0e8' },
								children: displayQuote,
							},
						},
					},
				},
				// Attribution + context
				{
					type: 'div',
					props: {
						style: { display: 'flex', flexDirection: 'column', gap: '6px' },
						children: [
							speakerName
								? {
										type: 'span',
										props: {
											style: { fontSize: 22, color: '#d4a44a', fontWeight: 400 },
											children: `\u2014 ${speakerName}`,
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
			],
		},
	};
}

// Shared background layers
function bgLayers() {
	return [
		{ type: 'div', props: { style: { position: 'absolute', top: '-250px', left: '-100px', width: '800px', height: '800px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(219,165,75,0.04) 0%, transparent 65%)' } } },
		{ type: 'div', props: { style: { position: 'absolute', bottom: '-200px', right: '-150px', width: '700px', height: '700px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(210,105,72,0.045) 0%, transparent 65%)' } } },
		{ type: 'div', props: { style: { position: 'absolute', bottom: '-570px', left: '-10px', width: '1220px', height: '980px', borderRadius: '50%', border: '50px solid rgba(219,159,66,0.02)' } } },
		{ type: 'div', props: { style: { position: 'absolute', bottom: '-520px', left: '50px', width: '1100px', height: '900px', borderRadius: '50%', border: '1.5px solid rgba(212,164,74,0.32)' } } },
		{ type: 'div', props: { style: { position: 'absolute', bottom: '-680px', left: '-80px', width: '1360px', height: '1100px', borderRadius: '50%', border: '1px solid rgba(212,164,74,0.1)' } } },
		{ type: 'div', props: { style: { position: 'absolute', bottom: '-840px', left: '-210px', width: '1620px', height: '1300px', borderRadius: '50%', border: '1px solid rgba(212,164,74,0.05)' } } },
	];
}

async function renderToFile(element: any, allText: string, filename: string) {
	const [fontRegular, fontBold] = await Promise.all([fetchFont(allText, 400), fetchFont(allText, 700)]);
	console.log(`Fonts: ${fontRegular.byteLength}B (400), ${fontBold.byteLength}B (700)`);

	const svg = await satori(element as any, {
		width: OG_WIDTH,
		height: OG_HEIGHT,
		fonts: [
			{ name: 'Noto Sans TC', data: fontRegular, weight: 400 as const, style: 'normal' as const },
			{ name: 'Noto Sans TC', data: fontBold, weight: 700 as const, style: 'normal' as const },
		],
	});

	const wasmPath = join(__dirname, '..', 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
	try { await initWasm(readFileSync(wasmPath)); } catch {}

	const pngData = new Resvg(svg, { fitTo: { mode: 'width' as const, value: OG_WIDTH } }).render().asPng();
	const outPath = join(__dirname, '..', filename);
	writeFileSync(outPath, pngData);
	console.log(`Written ${outPath} (${pngData.length} bytes)`);
}

async function main() {
	// Speech-level OG
	const title = '仁工智慧對話';
	const date = '2026-03-13';
	const speakers = ['問', '唐鳳'];
	const allText1 = ['SAYIT ARCHIVE', title, date, '\u00b7', ...speakers].join('');
	console.log('--- Speech OG ---');
	await renderToFile(buildElement(title, date, speakers), allText1, 'og-preview.png');

	// Quote-level OG
	const quoteText = '像 GDP 這種抽象指標，極容易被人為灌高。你可以先毀掉某樣東西，再花錢讓人重建。如果摧毀者和重建者都是 AI 系統，那麼你完全可以先製造痛苦，再去治療它——GDP 因而可以被無限墊高。但如果你只是把孩子們聚在一起，圍成一圈講故事，那裡沒有 GDP，因為沒有交易。';
	const allText2 = ['SAYIT ARCHIVE', quoteText.slice(0, 130), '\u2014', '唐鳳', '2026-03-13 仁工智慧對話', '\u2026'].join('');
	console.log('--- Quote OG ---');
	await renderToFile(
		buildQuoteElement(quoteText, '唐鳳', '2026-03-13 仁工智慧對話'),
		allText2,
		'og-preview-quote.png'
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
