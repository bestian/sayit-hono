import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Compiles this app's `.vue` SFCs (src/views/*, src/components/*) directly
 * to SSR render functions, in place, as a live Vite transform.
 *
 * Replaces the former scripts/build-views.ts: a hand-invoked CLI step that
 * wrote compiled output to a separate src/.generated/ directory (requiring
 * a manual rerun after every .vue edit, `@ts-nocheck` on the whole output,
 * and regex rewriting of relative imports to compensate for the directory
 * relocation). Because this plugin compiles modules IN PLACE (Vite keeps
 * the original src/views/Foo.vue path as the module id), neither problem
 * exists here: relative imports resolve normally, and there's nothing to
 * suppress typechecking on since nothing is written to disk.
 *
 * This app has no client bundle or hydration (see CLAUDE.md — SSR-only,
 * renderToString then done). Every view/component therefore additionally
 * exports its compiled CSS as a `styles` string constant, which
 * src/ssr/render.ts inlines directly into the response HTML — there is no
 * browser-loaded stylesheet asset for scoped styles to attach to. The
 * scopeId used for style-scoping (`${name}-ssr`) and every compiler option
 * below is copied verbatim from the retired scripts/build-views.ts so
 * output is byte-for-byte equivalent to what shipped before this plugin
 * (compileStyle isProd:false, compileScript inlineTemplate:true with
 * ssr:true, compileTemplate ssr:true as the template-only fallback).
 */
export function sfcSsrPlugin(): Plugin {
	return {
		name: 'sayit-sfc-ssr',
		enforce: 'pre',
		transform(code, id) {
			if (!id.endsWith('.vue')) return null;

			const filename = id;
			const name = path.basename(filename, '.vue');
			const scopeId = `${name}-ssr`;
			const { descriptor } = parse(code, { filename });

			if (!descriptor.template) {
				throw new Error(`檔案 ${filename} 缺少 <template> 區塊`);
			}

			const hasScoped = (descriptor.styles ?? []).some((style) => style.scoped);

			const styles = (descriptor.styles ?? [])
				.map((style, index) => {
					const result = compileStyle({
						filename,
						id: scopeId,
						source: style.content,
						scoped: style.scoped ?? false,
						isProd: false
					});
					if (result.errors.length > 0) {
						throw new Error(
							`編譯樣式失敗（${filename} 第 ${index + 1} 個 <style>）：${result.errors
								.map((err) => String(err))
								.join('; ')}`
						);
					}
					return result.code;
				})
				.join('\n');

			const hasScript = Boolean(descriptor.script || descriptor.scriptSetup);
			let output: string;

			if (hasScript) {
				const compiledScript = compileScript(descriptor, {
					id: scopeId,
					inlineTemplate: true,
					templateOptions: {
						ssr: true,
						scoped: hasScoped,
						ssrCssVars: descriptor.cssVars
					}
				});

				output = `${compiledScript.content}

export const styles = ${JSON.stringify(styles)};
`;
			} else {
				const { code: templateCode } = compileTemplate({
					source: descriptor.template.content,
					filename,
					id: scopeId,
					ssr: true,
					scoped: hasScoped,
					ssrCssVars: descriptor.cssVars
				});

				output = `import { defineComponent } from 'vue';
${templateCode}

const _sfc_main = defineComponent({ name: '${name}' });
_sfc_main.ssrRender = ssrRender;

export const styles = ${JSON.stringify(styles)};
export default _sfc_main;
`;
			}

			return { code: output, map: null };
		}
	};
}
