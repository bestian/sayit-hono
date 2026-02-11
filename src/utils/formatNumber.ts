/**
 * 將數字轉成千分位字串，例如 400841 → "400,841"
 */
export function formatNumberWithCommas(n: number): string {
	return n.toLocaleString('en-US');
}
