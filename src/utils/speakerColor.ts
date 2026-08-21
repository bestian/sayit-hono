// Restrained categorical colours for Turnline segments and portrait rules.
// Speaker names remain visible, so colour is never the sole identity cue.
const SPEAKER_PALETTE = ['#1d6775', '#355d8c', '#6b508a', '#8a4b66', '#975143', '#7a6224', '#42704c', '#4e6670'];

// not lsc-verifiable: BitOr(hash, 0)'s precondition (x >= 0) cannot be proved
// because hash can go negative during accumulation — a signed-bitwise/int
// abstraction gap in lsc's Dafny backend, not a code defect.
//@ ensures \result >= 0
function hashString(value: string): number {
	let hash = 0;
	//@ invariant 0 <= i && i <= value.length
	//@ decreases value.length - i
	for (let i = 0; i < value.length; i++) {
		hash = (hash << 5) - hash + value.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

//@ ensures \result in SPEAKER_PALETTE
export function getSpeakerColor(key?: string | null): string {
	const palette = SPEAKER_PALETTE;
	if (!key) return palette[0];
	const index = hashString(key) % palette.length;
	return palette[index];
}

export const speakerColorPalette = SPEAKER_PALETTE;
