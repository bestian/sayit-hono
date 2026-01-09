// Legacy palette extracted from原始靜態頁示例，保持顏色穩定且無需前端運算
const LEGACY_PALETTE = [
	'#9c4f2d',
	'#9bcd6c',
	'#e10dec',
	'#434202',
	'#60396c',
	'#5fd36d',
	'#0a13a1',
	'#457127',
	'#619b7f',
	'#639d67',
	'#6f13dd',
	'#88547b',
	'#eb5d10',
	'#f0990a',
	'#c512b2',
	'#d47733',
	'#b17656',
	'#4d89d2'
];

function hashString(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash << 5) - hash + value.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

export function getSpeakerColor(key?: string | null): string {
	const palette = LEGACY_PALETTE;
	if (!key) return palette[0];
	const index = hashString(key) % palette.length;
	return palette[index];
}

export const speakerColorPalette = LEGACY_PALETTE;

