// Ambient module shape for `.vue` imports, as compiled in place by
// vite-plugin-sfc-ssr.ts. `tsgo --noEmit` type-checks *.ts against this
// shim (it does not run Vue SFC internals through the Vite pipeline);
// consumers get an accurate export shape without needing a separate
// vue-tsc pass, matching what every view/component actually exports.
declare module '*.vue' {
	import type { DefineComponent } from 'vue';
	const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
	export const styles: string;
	export default component;
}
