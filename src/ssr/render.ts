import { createSSRApp, type Component } from 'vue';
import { renderToString } from '@vue/server-renderer';
import type { HeadSpec } from './heads';

const BASE_HEAD = `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta property="og:url" content="https://sayit.archive.tw">
  <meta property="og:site_name" content="SayIt">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://sayit-hono.audreyt.workers.dev/static/speeches/img/apple-touch-icon-152x152.png">
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
	title?: string;
	head?: HeadSpec;
	styles?: string;
	components?: Record<string, Component>;
	props?: Record<string, unknown>;
	scripts?: string;
};

function renderMeta(head?: HeadSpec) {
	const entries = head?.meta ?? [];
	return entries
		.map((meta) => {
			if (meta.property) {
				return `<meta property="${meta.property}" content="${meta.content}">`;
			}
			if (meta.name) {
				return `<meta name="${meta.name}" content="${meta.content}">`;
			}
			return '';
		})
		.filter(Boolean)
		.join('\n  ');
}

function wrapHtml(appHtml: string, { title, styles, head, scripts }: RenderOptions) {
	const headTitle = head?.title ?? (title ? `${title} :: SayIt` : 'SayIt');
	const inlineStyles = styles?.trim() ? `<style>${styles}</style>` : '';
	const metaTags = renderMeta(head);
	const extraScripts = scripts?.trim() ? `  ${scripts}` : '';

	return `<!DOCTYPE html>
<html class="no-touch" lang="zh-Hant">
<head>
  ${BASE_HEAD}
  <script>
    (function() {
      var root = document.documentElement;
      var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      root.classList.remove('no-touch');
      root.classList.add(hasTouch ? 'touch' : 'no-touch');
    })();
  </script>
  <title>${headTitle}</title>
  ${metaTags}
  ${inlineStyles}
</head>
<body id="top">
  <div id="app">${appHtml}</div>
${extraScripts}
</body>
</html>`;
}

export async function renderHtml(
	component: Component,
	{ title, styles, components, props, head, scripts }: RenderOptions
) {
	const app = createSSRApp(component, props);

	if (components) {
		for (const [name, instance] of Object.entries(components)) {
			app.component(name, instance);
		}
	}

	const appHtml = await renderToString(app);
	return wrapHtml(appHtml, { title, styles, head, scripts });
}

