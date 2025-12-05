import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderHtml } from '../src/ssr/render';
import type { Component } from 'vue';
import { buildViews } from './build-views';

type PageSpec = {
	filename: string;
	title: string;
	styles?: string;
	component: Component;
	components: Record<string, Component>;
	aliases?: string[];
};

function mergeStyles(...styles: Array<string | undefined>) {
	return styles.filter(Boolean).join('\n');
}

async function loadCompiledEntries() {
	await buildViews();
	const [views, components] = await Promise.all([
		import(pathToFileURL(path.resolve('src/.generated/views/index.ts')).href),
		import(pathToFileURL(path.resolve('src/.generated/components/index.ts')).href)
	]);

	return { views, components };
}

async function renderPage({ component, title, styles, filename, components, aliases }: PageSpec) {
	const html = await renderHtml(component, { title, styles, components });

	const outDir = path.resolve('www');
	await mkdir(outDir, { recursive: true });

	const targets = [filename, ...(aliases ?? [])];
	for (const target of targets) {
		const fullPath = path.join(outDir, target);
		await mkdir(path.dirname(fullPath), { recursive: true });
		await writeFile(fullPath, html, 'utf8');
	}
}

async function prerender() {
	const { views, components } = await loadCompiledEntries();
	const sharedComponents = { Navbar: components.Navbar, Footer: components.Footer };
	const sharedStyles = mergeStyles(components.NavbarStyles, components.FooterStyles);

	const pages: PageSpec[] = [
		{
			filename: 'index.html',
			title: 'Home',
			styles: mergeStyles(views.HomeViewStyles, sharedStyles),
			component: views.HomeView,
			components: sharedComponents
		},
		{
			filename: 'about.html',
			title: 'About',
			styles: mergeStyles(views.AboutViewStyles, sharedStyles),
			component: views.AboutView,
			components: sharedComponents,
			aliases: ['about/index.html']
		}
	];

	await Promise.all(pages.map(renderPage));

	// 將 public 複製到 www，以支援預覽與部署靜態資源
	const publicDir = path.resolve('public');
	const outDir = path.resolve('www');
	// 保留與 public 相同的目錄結構（含根層 favicon/robots 與 static 目錄）
	await cp(publicDir, outDir, { recursive: true });
}

prerender().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

