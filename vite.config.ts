import { defineConfig } from 'vite';
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
	plugins: [cloudflare(), sfcSsrPlugin()]
});
