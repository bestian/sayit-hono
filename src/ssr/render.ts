import { createSSRApp, type Component } from 'vue';
import { renderToString } from '@vue/server-renderer';

type RenderOptions = {
	title: string;
	styles?: string;
};

export async function renderHtml(component: Component, { title, styles }: RenderOptions) {
	const app = createSSRApp(component);
	const appHtml = await renderToString(app);
	const styleBlock = styles ? `<style>${styles}</style>` : '';

	return `<!DOCTYPE html>
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
}

