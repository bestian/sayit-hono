import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { buildViews } from './build-views';

type PageSpec = {
	filename: string;
	title: string;
	styles?: string;
	Component: unknown;
};

async function loadCompiledViews() {
	await buildViews();
	const url = pathToFileURL(path.resolve('src/.generated/views/index.ts')).href;
	return import(url);
}

async function renderPage({ Component, title, styles, filename }: PageSpec) {
	// styles 會在 head 直接內嵌，避免額外 asset。
	const app = createSSRApp(Component as object);
	const appHtml = await renderToString(app);
	const styleBlock = styles ? `<style>${styles}</style>` : '';

	const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  ${styleBlock}
</head>
<body>
  <div id="app">${appHtml}</div>
</body>
</html>`;

	const outDir = path.resolve('www');
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, filename), html, 'utf8');
}

async function prerender() {
	const views = await loadCompiledViews();

	const pages: PageSpec[] = [
		{
			filename: 'index.html',
			title: 'Home',
			styles: views.HomeViewStyles,
			Component: views.HomeView
		},
		{
			filename: 'about.html',
			title: 'About',
			styles: views.AboutViewStyles,
			Component: views.AboutView
		}
	];

	await Promise.all(pages.map(renderPage));
}

prerender().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

