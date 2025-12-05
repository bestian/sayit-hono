import { createSSRApp, type Component } from 'vue';
import { renderToString } from '@vue/server-renderer';

const BASE_HEAD = `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta property="og:url" content="https://sayit.pdis.nat.gov.tw">
  <meta property="og:title" content="SayIt">
  <meta property="og:site_name" content="SayIt">
  <meta property="og:description" content="Transcripts for the modern internet">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://sayit.pdis.nat.gov.tw/static/speeches/img/apple-touch-icon-152x152.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="152">
  <meta property="og:image:height" content="152">
  <meta name="google-site-verification" content="DiXRH7TWCHjMPvi1kvFkDgwpHBGkbFkR2Rxki-iGh2o">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@100;300;400;500;700&display=swap" rel="stylesheet">
  <link href="/static/speeches/css/speeches.css" rel="stylesheet" type="text/css">
  <script type="text/javascript" src="/static/speeches/js/jquery.js" charset="utf-8"></script>
  <script type="text/javascript" src="/static/speeches/js/select2-override.js" charset="utf-8"></script>`;

type RenderOptions = {
	title: string;
	styles?: string;
	components?: Record<string, Component>;
	props?: Record<string, unknown>;
};

function wrapHtml(appHtml: string, { title, styles }: RenderOptions) {
	const inlineStyles = styles?.trim() ? `<style>${styles}</style>` : '';

	return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  ${BASE_HEAD}
  <title>${title} :: SayIt</title>
  ${inlineStyles}
</head>
<body id="top">
  <div id="app">${appHtml}</div>
</body>
</html>`;
}

export async function renderHtml(component: Component, { title, styles, components, props }: RenderOptions) {
	const app = createSSRApp(component, props);

	if (components) {
		for (const [name, instance] of Object.entries(components)) {
			app.component(name, instance);
		}
	}

	const appHtml = await renderToString(app);
	return wrapHtml(appHtml, { title, styles });
}

