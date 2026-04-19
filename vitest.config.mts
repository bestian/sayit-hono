import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.vitest.jsonc' },
			},
		},
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'html'],
			include: ['src/**'],
			exclude: [
				'src/**/*.vue',
				'src/.generated/**',
				'src/api/og.ts',
				'src/api/og_loader.ts',
				'src/marked.d.ts',
				'src/api/types.ts',
			],
			thresholds: {
				// CI fails if any included file dips below 100% lines/functions.
				// Statements/branches are intentionally loose: istanbul instruments every
				// short-circuit (`??`, `||`, `?.`) as a branch; some of those are defensive
				// paths against runtime-impossible inputs that we don't manufacture in tests.
				lines: 100,
				functions: 100,
				perFile: true,
			},
		},
	},
});
