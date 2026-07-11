import { defineConfig, lazyPlugins } from 'vite-plus';
import { cloudflare } from '@cloudflare/vite-plugin';
import { sfcSsrPlugin } from './vite-plugin-sfc-ssr';

// SSR-only app: no client hydration, no vue-router, no App.vue. Every page is
// rendered server-side via @vue/server-renderer's renderToString inside the
// Worker (src/ssr/render.ts). sfcSsrPlugin() compiles src/views/*.vue and
// src/components/*.vue to SSR render functions in place — see that file for
// why this app can't use the stock @vitejs/plugin-vue (no browser CSS asset
// pipeline exists to attach scoped styles to; every view inlines its own
// compiled `styles` string into the response HTML instead).
export default defineConfig({
	staged: {
		'src/**/*.{ts,vue}': 'vp check --fix',
		'scripts/**/*.ts': 'vp check --fix',
		'vite.config.ts': 'vp check --fix',
		'vite-plugin-sfc-ssr.ts': 'vp check --fix',
		'test/**/*.ts': 'vp fmt --write',
	},
	fmt: {
		printWidth: 140,
		singleQuote: true,
		semi: true,
		useTabs: true,
		sortPackageJson: false,
		ignorePatterns: ['**/*.vue'],
	},
	lint: {
		plugins: ['typescript', 'unicorn', 'oxc'],
		categories: {
			correctness: 'error',
		},
		rules: {
			'vite-plus/prefer-vite-plus-imports': 'error',
		},
		env: {
			builtin: true,
		},
		// Third-party vendored static JS (unbundled, served as-is to the browser) —
		// never a TS/type-checked module. First-party public/static/speeches/js/*
		// glue (pagefind-search.js, select2-override.js, speeches.js,
		// fuse-search.worker.js) stays in scope and must lint clean.
		ignorePatterns: [
			'public/static/speeches/js/jquery.js',
			'public/static/speeches/js/fuse.min.js',
			'public/static/speeches/js/masonry.pkgd.min.js',
			'public/static/speeches/js/foundation/**',
		],
		options: {
			typeAware: true,
			typeCheck: true,
		},
		jsPlugins: [
			{
				name: 'vite-plus',
				specifier: 'vite-plus/oxlint-plugin',
			},
		],
	},
	plugins: lazyPlugins(() => [cloudflare(), sfcSsrPlugin()]),
	// satori references process / process.env, which don't exist in Workers.
	// Previously lived in wrangler.jsonc's `define` — the Vite build path
	// ignores that (Vite owns `define` once the Cloudflare Vite plugin is in
	// play), so it moves here verbatim.
	define: {
		'process.env.NODE_ENV': '"production"',
		'process.env.SATORI_STANDALONE': 'undefined',
		'process.env.JEST_WORKER_ID': 'undefined',
		'process.env': '{}',
		process: '{"env":{}}',
	},
});
