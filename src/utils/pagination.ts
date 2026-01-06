// 通用的分頁頁碼生成器：固定顯示首尾，當前前後各 1，必要時以省略號銜接
export function buildPaginationPages(current: number, total: number): Array<number | 'ellipsis'> {
	const pages: Array<number | 'ellipsis'> = [];
	const added = new Set<number>();

	if (total <= 7) {
		for (let i = 1; i <= total; i++) pages.push(i);
		return pages;
	}

	pages.push(1);
	added.add(1);

	const nearStart = Math.max(2, current - 1);
	const nearEnd = Math.min(total - 2, current + 1);

	if (nearStart > 2) pages.push('ellipsis');

	for (let i = nearStart; i <= nearEnd; i++) {
		if (!added.has(i)) {
			pages.push(i);
			added.add(i);
		}
	}

	const lastTwoStart = total - 1;
	if (nearEnd < lastTwoStart - 1) pages.push('ellipsis');

	if (!added.has(lastTwoStart)) {
		pages.push(lastTwoStart);
		added.add(lastTwoStart);
	}
	if (!added.has(total)) {
		pages.push(total);
		added.add(total);
	}

	return pages;
}

