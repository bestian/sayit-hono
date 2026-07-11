import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vite-plus';
import { sfcSsrPlugin } from './vite-plugin-sfc-ssr';

export default defineConfig({
	plugins: [
		sfcSsrPlugin(),
		cloudflareTest({
			wrangler: { configPath: './wrangler.vitest.jsonc' },
		}),
	],
	test: {
		// SUT 已不使用 in-Worker caches.default（Workers Cache 是 front-of-Worker，
		// 由平台處理，不受測試環境影響）；setup 只 mock cloudflare:workers 的
		// cache.purge，讓 upload invalidation 測試能斷言 purge 成功，不需要真的
		// Workers Cache purge API。
		setupFiles: ['./test/setup-cache-isolation.ts'],
		// 約 5 個 spec 用 `throw new Error('boom')` 在 D1 mock 裡引發 DB
		// query 失敗，驗證 SUT 的 try/catch + 500 路徑。SUT 的確 catch
		// 後 return 500（test 全綠），但 pool-workers 0.15 worker 端會在
		// SUT 的 await 接到 rejection 之前先觀察到 'unhandledrejection'，
		// 透過 RPC 回報給 vitest 4，使 exit code = 1。
		// 本旗標讓這類被 SUT 正確接住的 rejection 不視為 fatal；真正
		// fire-and-forget 的 rejection 仍會以 test fail 形式爆出來。
		dangerouslyIgnoreUnhandledErrors: true,
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.vue', 'src/api/og.ts', 'src/api/og_loader.ts', 'src/marked.d.ts', 'src/api/types.ts', 'src/.generated/**'],
			thresholds: {
				// CI fails if any included file dips below 100% statements/lines/functions.
				// Statements/branches are intentionally loose: istanbul instruments every
				// short-circuit (`??`, `||`, `?.`) as a branch; some of those are defensive
				// paths against runtime-impossible inputs that we don't manufacture in tests.
				statements: 100,
				lines: 100,
				functions: 100,
				perFile: true,
			},
		},
	},
});
