// 通用的分頁頁碼生成器：固定顯示首尾，當前前後各 1，必要時以省略號銜接
// not lsc-verifiable: TypeScript union type Array<number | 'ellipsis'> emits seq<number | 'ellipsis'> which is not valid Dafny syntax — 2 parse errors prevent verification
//@ requires total >= 1
//@ requires current >= 1 && current <= total
//@ ensures \result.length > 0
//@ ensures \result[0] == 1
//@ ensures \result[\result.length - 1] == total
export function buildPaginationPages(current: number, total: number): Array<number | 'ellipsis'> {
	const pages: Array<number | 'ellipsis'> = [];

	if (total <= 7) {
		for (let i = 1; i <= total; i++) pages.push(i);
		return pages;
	}

	pages.push(1);

	const nearStart = Math.max(2, current - 1);
	const nearEnd = Math.min(total - 2, current + 1);

	if (nearStart > 2) pages.push('ellipsis');

	for (let i = nearStart; i <= nearEnd; i++) pages.push(i);

	const lastTwoStart = total - 1;
	if (nearEnd < lastTwoStart - 1) pages.push('ellipsis');

	pages.push(lastTwoStart);
	pages.push(total);

	return pages;
}
