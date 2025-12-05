import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileTemplate, parse } from '@vue/compiler-sfc';

const VIEWS_DIR = path.resolve('src/views');
const COMPONENTS_DIR = path.resolve('src/components');
const OUT_VIEWS_DIR = path.resolve('src/.generated/views');
const OUT_COMPONENTS_DIR = path.resolve('src/.generated/components');

const header = `// 由 scripts/build-views.ts 自動產生，請勿手動編輯
`;

type CompileTarget = {
	sourceDir: string;
	outDir: string;
	emptyMessage: string;
};

async function ensureDirectory(dir: string) {
	await mkdir(dir, { recursive: true });
}

async function compileSfc(file: string, target: CompileTarget) {
	const filename = path.join(target.sourceDir, file);
	const source = await readFile(filename, 'utf8');
	const { descriptor } = parse(source, { filename: file });

	if (!descriptor.template) {
		throw new Error(`檔案 ${file} 缺少 <template> 區塊`);
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

	await writeFile(path.join(target.outDir, `${name}.ts`), output, 'utf8');
	return `export { default as ${name}, styles as ${name}Styles } from './${name}.ts';`;
}

async function buildTarget(target: CompileTarget) {
	await ensureDirectory(target.outDir);
	const files = (await readdir(target.sourceDir)).filter((file) => file.endsWith('.vue'));

	const exports: string[] = [];
	for (const file of files) {
		const exportLine = await compileSfc(file, target);
		exports.push(exportLine);
	}

	const indexContent =
		files.length === 0
			? `${header}// ${target.emptyMessage}\n`
			: `${header}${exports.join('\n')}\n`;

	await writeFile(path.join(target.outDir, 'index.ts'), indexContent, 'utf8');
}

export async function buildViews() {
	await Promise.all([
		buildTarget({
			sourceDir: VIEWS_DIR,
			outDir: OUT_VIEWS_DIR,
			emptyMessage: '無可用的 view'
		}),
		buildTarget({
			sourceDir: COMPONENTS_DIR,
			outDir: OUT_COMPONENTS_DIR,
			emptyMessage: '無可用的 component'
		})
	]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	buildViews().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}

