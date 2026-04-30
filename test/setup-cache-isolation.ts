// 0.15 的 @cloudflare/vitest-pool-workers 不再 per-test 自動清空 caches.default
// （只清 KV / R2 / D1 / DO），而我們的 SUT 在 RSS / .md / .an / OG / SSR
// 等路徑都會先 readEdgeCache(...)，命中就直接 return cached body —— tests
// 之間會跨檔案互相看到上一個 test 寫進 caches.default 的 body。
//
// 把 caches.default 換成一個記憶體 Map 實作，並在每個 test 開始前清空：
// - 同一個 test 內 put / match / delete 行為正確（含對 edge-cache hit
//   path 的測試，例如 rss_edges 的 "serves an edge-cached body before
//   checking R2 or DB"）。
// - 跨 test 一定空白，符合 0.8 implicit isolation 的既有期待。
//
// 對 SUT 是透明的 —— 只要它依舊呼叫 caches.default.{match,put,delete}。

import { beforeEach } from 'vitest';

let store = new Map<string, { body: ArrayBuffer; init: ResponseInit }>();

function keyFromInput(input: RequestInfo | URL): string {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

const stubbed = {
	match: async (input: RequestInfo | URL): Promise<Response | undefined> => {
		const entry = store.get(keyFromInput(input));
		if (!entry) return undefined;
		return new Response(entry.body.slice(0), entry.init);
	},
	matchAll: async () => [] as Response[],
	add: async () => {
		throw new Error('caches.default.add not implemented in test stub');
	},
	addAll: async () => {
		throw new Error('caches.default.addAll not implemented in test stub');
	},
	put: async (input: RequestInfo | URL, response: Response): Promise<void> => {
		const key = keyFromInput(input);
		const cloned = response.clone();
		const body = await cloned.arrayBuffer();
		const headers: Record<string, string> = {};
		response.headers.forEach((value, name) => {
			headers[name] = value;
		});
		store.set(key, { body, init: { status: response.status, statusText: response.statusText, headers } });
	},
	delete: async (input: RequestInfo | URL): Promise<boolean> => store.delete(keyFromInput(input)),
	keys: async () => [] as Request[],
} as unknown as Cache;

Object.defineProperty(caches, 'default', {
	configurable: true,
	get: () => stubbed,
});

beforeEach(() => {
	store = new Map();
});
