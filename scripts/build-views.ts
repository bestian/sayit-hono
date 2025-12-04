import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileTemplate, parse } from '@vue/compiler-sfc';

const VIEWS_DIR = path.resolve('src/views');
const OUT_DIR = path.resolve('src/.generated/views');

const header = `// 由 scripts/build-views.ts 自動產生，請勿手動編輯
`;

async function ensureViewsDirectory() {
	await mkdir(OUT_DIR, { recursive: true });
}

async function compileView(file: string) {
	const filename = path.join(VIEWS_DIR, file);
	const source = await readFile(filename, 'utf8');
	const { descriptor } = parse(source, { filename: file });

	if (!descriptor.template) {
		throw new Error(`View ${file} 缺少 <template> 區塊`);
	}

	const name = path.basename(file, '.vue');
	const id = `${name}-ssr`;

	const { code: templateCode } = compileTemplate({
		source: descriptor.template.content,
		filename: file,
		id,
		ssr: true
	});

	const styles = (descriptor.styles ?? []).map((style) => style.content).join('\n');

	const output = `${header}import { defineComponent } from 'vue';
${templateCode}

const _sfc_main = defineComponent({ name: '${name}' });
_sfc_main.ssrRender = ssrRender;

export const styles = ${JSON.stringify(styles)};
export default _sfc_main;
`;

	await writeFile(path.join(OUT_DIR, `${name}.ts`), output, 'utf8');
	return `export { default as ${name}, styles as ${name}Styles } from './${name}.ts';`;
}

export async function buildViews() {
	await ensureViewsDirectory();
	const files = (await readdir(VIEWS_DIR)).filter((file) => file.endsWith('.vue'));

	const exports: string[] = [];
	for (const file of files) {
		const exportLine = await compileView(file);
		exports.push(exportLine);
	}

	const indexContent =
		files.length === 0
			? `${header}// 無可用的 view\n`
			: `${header}${exports.join('\n')}\n`;

	await writeFile(path.join(OUT_DIR, 'index.ts'), indexContent, 'utf8');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	buildViews().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}

