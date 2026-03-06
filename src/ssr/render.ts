import { createSSRApp, type Component } from 'vue';
import { renderToString } from '@vue/server-renderer';
import type { HeadSpec } from './heads';

const BASE_HEAD = `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b121a">
  <meta property="og:url" content="https://sayit.archive.tw">
  <meta property="og:site_name" content="SayIt">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://sayit.archive.tw/static/speeches/img/apple-touch-icon-152x152.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="152">
  <meta property="og:image:height" content="152">
  <meta name="google-site-verification" content="DiXRH7TWCHjMPvi1kvFkDgwpHBGkbFkR2Rxki-iGh2o">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@100;300;400;500;700&display=swap" rel="stylesheet">
  <link href="/static/speeches/css/speeches.css" rel="stylesheet" type="text/css">
  <script type="text/javascript" src="/static/speeches/js/jquery.js" charset="utf-8"></script>
  <script type="text/javascript" src="/static/speeches/js/select2-override.js" charset="utf-8"></script>`;

const THEME_STYLES = `<style>
  :root {
    color-scheme: light;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --sayit-bg: #081018;
      --sayit-bg-elevated: rgba(13, 19, 29, 0.9);
      --sayit-bg-soft: rgba(18, 27, 39, 0.88);
      --sayit-bg-muted: rgba(24, 35, 49, 0.92);
      --sayit-surface: rgba(15, 22, 32, 0.88);
      --sayit-surface-strong: rgba(21, 31, 43, 0.96);
      --sayit-surface-highlight: rgba(28, 41, 56, 0.96);
      --sayit-border: rgba(164, 184, 204, 0.14);
      --sayit-border-strong: rgba(190, 210, 230, 0.24);
      --sayit-text: #ecf2f8;
      --sayit-text-muted: #b8c4d1;
      --sayit-text-dim: #8f9cab;
      --sayit-link: #ff9a8d;
      --sayit-link-hover: #ffd0c7;
      --sayit-accent: #7fd6b0;
      --sayit-accent-strong: #a3efd0;
      --sayit-highlight: rgba(255, 211, 125, 0.2);
      --sayit-shadow: 0 18px 40px rgba(0, 0, 0, 0.32);
    }

    html {
      background: #070c12;
    }

    body {
      color: var(--sayit-text);
      background:
        radial-gradient(circle at top left, rgba(66, 113, 119, 0.24), transparent 34%),
        radial-gradient(circle at top right, rgba(139, 66, 74, 0.18), transparent 26%),
        linear-gradient(180deg, #0d141c 0%, #091017 48%, #070c12 100%);
      background-attachment: fixed;
    }

    ::selection {
      background: rgba(127, 214, 176, 0.28);
      color: #fff;
    }

    a {
      color: var(--sayit-link);
    }

    a:hover,
    a:focus {
      color: var(--sayit-link-hover);
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    h6,
    .search-title-with-result strong {
      color: var(--sayit-text);
    }

    small,
    label,
    abbr,
    acronym,
    .subheader,
    .breadcrumbs__date,
    .person-summary,
    .stat__descriptor,
    .search-title-with-result,
    .speech__links a,
    blockquote,
    blockquote p,
    blockquote cite,
    blockquote cite a,
    blockquote cite a:visited,
    .ui-instructions,
    .ui-instructions h2,
    .speaker-list a,
    .search-results-speakers a,
    .search-results-speakers li,
    #cc,
    #privacy,
    #tos,
    .sayit-search__status,
    .sayit-search__result-meta,
    .sayit-search__loading,
    .page-header .tip {
      color: var(--sayit-text-muted);
    }

    abbr,
    acronym {
      border-bottom-color: var(--sayit-border);
    }

    code {
      color: #ffd29a;
    }

    hr,
    blockquote,
    .breadcrumbs,
    .page-header,
    .section-signpost,
    .speech__content,
    .speech--search-result,
    .speaker-card,
    .stat,
    .key-descriptor,
    #sayit-speech-list .section-title a,
    .speech--section-signpost .section-title a,
    .section-page__speeches-collection h2 {
      border-color: var(--sayit-border);
    }

    .navbar {
      background: linear-gradient(180deg, rgba(12, 18, 28, 0.9), rgba(12, 18, 28, 0.72));
      border-bottom: 1px solid var(--sayit-border);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
    }

    .navbar a {
      color: var(--sayit-text-muted);
    }

    .navbar .inline-list a {
      display: inline-block;
      padding: 0.35em 0.65em;
      border-radius: 999px;
      transition: background 0.2s ease, color 0.2s ease;
    }

    .navbar .inline-list a:hover,
    .navbar .inline-list a:focus {
      color: var(--sayit-text);
      background: rgba(127, 214, 176, 0.12);
    }

    footer.full-page__row {
      border-top: 1px solid var(--sayit-border);
      background: rgba(8, 13, 20, 0.62);
    }

    .homepage-search h2 {
      color: var(--sayit-text);
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
    }

    .homepage-stats .full-page__unit {
      color: var(--sayit-text-muted) !important;
    }

    .homepage-stats strong {
      color: var(--sayit-accent-strong) !important;
    }

    .homepage-stats a:hover strong {
      color: #d9fff0 !important;
    }

    .breadcrumbs {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      max-width: 100%;
      padding: 0.4rem 0.8rem;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--sayit-border);
      border-radius: 999px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    .breadcrumbs > * {
      float: none;
      font-size: 0.82rem;
    }

    .breadcrumbs > * a,
    .breadcrumbs > * span,
    .breadcrumbs > *.current,
    .breadcrumbs > *.current a {
      color: var(--sayit-text-muted);
    }

    .breadcrumbs > *.current,
    .breadcrumbs > *.current a {
      color: var(--sayit-text);
    }

    .breadcrumbs > *:after {
      color: var(--sayit-text-dim);
      top: 0;
      padding: 0 0.55em;
    }

    input[type="text"],
    input[type="password"],
    input[type="date"],
    input[type="datetime"],
    input[type="datetime-local"],
    input[type="month"],
    input[type="week"],
    input[type="email"],
    input[type="number"],
    input[type="search"],
    input[type="tel"],
    input[type="time"],
    input[type="url"],
    textarea,
    select,
    .sayit-search__input,
    .site-search__input {
      color: var(--sayit-text);
      background: rgba(16, 23, 34, 0.88);
      border: 1px solid var(--sayit-border-strong);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
    }

    input[type="text"]:focus,
    input[type="password"]:focus,
    input[type="date"]:focus,
    input[type="datetime"]:focus,
    input[type="datetime-local"]:focus,
    input[type="month"]:focus,
    input[type="week"]:focus,
    input[type="email"]:focus,
    input[type="number"]:focus,
    input[type="search"]:focus,
    input[type="tel"]:focus,
    input[type="time"]:focus,
    input[type="url"]:focus,
    textarea:focus,
    select:focus,
    .sayit-search__input:focus,
    .site-search__input:focus {
      color: var(--sayit-text);
      background: rgba(20, 29, 42, 0.96);
      border-color: rgba(127, 214, 176, 0.72);
      box-shadow: 0 0 0 4px rgba(127, 214, 176, 0.14);
      outline: none;
    }

    input[type="text"]::placeholder,
    input[type="password"]::placeholder,
    input[type="date"]::placeholder,
    input[type="datetime"]::placeholder,
    input[type="datetime-local"]::placeholder,
    input[type="month"]::placeholder,
    input[type="week"]::placeholder,
    input[type="email"]::placeholder,
    input[type="number"]::placeholder,
    input[type="search"]::placeholder,
    input[type="tel"]::placeholder,
    input[type="time"]::placeholder,
    input[type="url"]::placeholder,
    textarea::placeholder,
    .sayit-search__input::placeholder,
    .site-search__input::placeholder {
      color: var(--sayit-text-dim);
    }

    .sayit-search__shortcut {
      color: var(--sayit-text-dim);
      background: rgba(30, 42, 56, 0.8);
      border-color: var(--sayit-border);
    }

    .sayit-search__results-inner,
    .speaker-card,
    .speaker-page__speeches-collection .speech-wrapper,
    .section-page__speeches-collection .speech-wrapper,
    .speech-single-speech,
    .sidebar,
    .single-speech-layout__speech-created {
      background: linear-gradient(180deg, rgba(18, 26, 37, 0.96), rgba(13, 19, 29, 0.9));
      border-color: var(--sayit-border);
      box-shadow: var(--sayit-shadow);
    }

    .sayit-search__results-inner {
      border: 1px solid var(--sayit-border);
      border-radius: 16px;
      padding: 0.2em 0.75em 0.5em;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }

    .speaker-card {
      transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease;
    }

    #sayit-speech-list {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      margin-top: 1.5rem;
    }

    #sayit-speech-list li {
      margin: 0;
    }

    #sayit-speech-list .section-title,
    .speech--section-signpost .section-title {
      display: block;
    }

    #sayit-speech-list .section-title a,
    .speech--section-signpost .section-title a {
      display: block;
      padding: 1rem 1.1rem;
      border: 1px solid var(--sayit-border);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(20, 29, 42, 0.96), rgba(13, 20, 31, 0.9));
      color: var(--sayit-text);
      box-shadow: 0 14px 28px rgba(0, 0, 0, 0.18);
      transition:
        transform 0.2s ease,
        border-color 0.2s ease,
        background 0.2s ease,
        color 0.2s ease;
    }

    #sayit-speech-list .section-title a:hover,
    #sayit-speech-list .section-title a:focus,
    .speech--section-signpost .section-title a:hover,
    .speech--section-signpost .section-title a:focus {
      color: var(--sayit-link-hover);
      border-color: var(--sayit-border-strong);
      background: linear-gradient(180deg, rgba(24, 35, 49, 0.98), rgba(16, 24, 36, 0.94));
      transform: translateY(-1px);
    }

    .sayit-search__result {
      border-bottom-color: var(--sayit-border);
    }

    .sayit-search__result:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .sayit-search__result-title {
      color: var(--sayit-text);
    }

    .sayit-search__result:hover .sayit-search__result-title {
      color: var(--sayit-accent-strong);
    }

    .sayit-search__result-excerpt,
    .sayit-search__sub-result-excerpt,
    .speech__content-link:hover,
    .speech__content-link:active,
    .speech__content-link:focus {
      color: var(--sayit-text-muted);
    }

    .sayit-search__sub-result {
      border-left-color: var(--sayit-border-strong);
    }

    .sayit-search__sub-result:hover {
      border-left-color: var(--sayit-accent);
      background: rgba(127, 214, 176, 0.08);
    }

    .sayit-search__spinner {
      border-color: rgba(184, 196, 209, 0.22);
      border-top-color: var(--sayit-accent);
    }

    button,
    .button,
    .pagination__page-number {
      color: #f7fbff;
      background: linear-gradient(180deg, #2b3f52 0%, #1e2e3f 100%);
      border: 1px solid rgba(181, 202, 219, 0.18);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.05),
        0 10px 20px rgba(0, 0, 0, 0.2);
    }

    button:hover,
    button:focus,
    .button:hover,
    .pagination__page-number:hover,
    .button:focus,
    .pagination__page-number:focus {
      color: #fff;
      background: linear-gradient(180deg, #35516a 0%, #284057 100%);
    }

    button.secondary,
    .button.secondary,
    .secondary.pagination__page-number {
      color: var(--sayit-text);
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--sayit-border-strong);
    }

    button.secondary:hover,
    button.secondary:focus,
    .button.secondary:hover,
    .secondary.pagination__page-number:hover,
    .button.secondary:focus,
    .secondary.pagination__page-number:focus {
      color: var(--sayit-text);
      background: rgba(127, 214, 176, 0.12);
    }

    button.disabled,
    button[disabled],
    .button.disabled,
    .disabled.pagination__page-number,
    .button[disabled],
    [disabled].pagination__page-number {
      color: var(--sayit-text-dim);
      background: rgba(123, 137, 153, 0.24);
      border-color: rgba(142, 159, 177, 0.14);
      box-shadow: none;
    }

    .pagination__page-number.current {
      color: #f5fffb;
      background: linear-gradient(180deg, #1e5f4c 0%, #153f35 100%);
      border-color: rgba(163, 239, 208, 0.38);
    }

    button.sayit-search__more {
      color: var(--sayit-text-muted);
      background: rgba(255, 255, 255, 0.02);
      border-color: var(--sayit-border-strong);
      box-shadow: none;
    }

    button.sayit-search__more:hover,
    button.sayit-search__more:focus {
      color: var(--sayit-text);
      background: rgba(127, 214, 176, 0.12);
      border-color: rgba(127, 214, 176, 0.5);
    }

    button.sayit-search__more:active {
      background: rgba(127, 214, 176, 0.18);
    }

    .breadcrumbs a,
    .speech__meta-data a,
    .speech__links a,
    .speech__content-link,
    .speaker-page__search .site-search__input,
    .sidebar a,
    .speech--search-result .speech__meta-data a {
      color: var(--sayit-text-muted);
    }

    .breadcrumbs a:hover,
    .breadcrumbs a:focus,
    .speech__meta-data a:hover,
    .speech__meta-data a:focus,
    .speech__links a:hover,
    .speech__links a:focus,
    .sidebar a:hover,
    .sidebar a:focus,
    .speech--search-result .speech__meta-data a:hover,
    .speech--search-result .speech__meta-data a:focus {
      color: var(--sayit-accent-strong);
    }

    .speech__content a,
    .speech--search-result .speech__content a {
      color: var(--sayit-accent);
    }

    .speech__content a:hover,
    .speech__content a:focus,
    .speech--search-result .speech__content a:hover,
    .speech--search-result .speech__content a:focus {
      color: var(--sayit-accent-strong);
    }

    .speech__links {
      background-color: rgba(10, 16, 24, 0.86);
      border-radius: 999px;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
    }

    .speech-single-speech .speech__meta-data,
    .speech-single-speech__speaker-portrait,
    .section-detail-sidebar,
    .sidebar__unit,
    .primary-content__unit {
      color: var(--sayit-text-muted);
    }

    .speech-single-speech .breadcrumbs {
      margin-top: 1rem;
    }

    .section-navigation {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
      margin-bottom: 1rem;
    }

    .speech--narrative {
      background: rgba(255, 255, 255, 0.04);
      border-top-color: var(--sayit-border);
      border-bottom-color: var(--sayit-border);
    }

    .sidebar {
      background: linear-gradient(180deg, rgba(20, 30, 41, 0.96), rgba(15, 22, 32, 0.92));
    }

    .single-speech-layout__speech-created {
      background: linear-gradient(180deg, rgba(57, 64, 37, 0.85), rgba(34, 39, 24, 0.92));
      border-color: rgba(181, 195, 107, 0.35);
      color: var(--sayit-text);
    }

    .search-results-speakers em,
    .section-signpost--as-search-result em,
    .speech--search-result em {
      color: var(--sayit-text);
    }

    .key-descriptor {
      background: rgba(255, 255, 255, 0.03);
    }

    mark,
    .sayit-search__result-excerpt mark,
    .sayit-search__sub-result-excerpt mark {
      color: var(--sayit-text);
      background: var(--sayit-highlight);
    }

    .speech:target {
      background-color: rgba(255, 211, 125, 0.12);
    }

    .speaker-portrait {
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22);
    }

    .icon-search,
    .speech-icon {
      filter: invert(1) brightness(1.25) opacity(0.82);
    }

    .speech-single-speech:before {
      border-right-color: var(--sayit-border-strong);
    }

    .speech-single-speech:after {
      border-right-color: rgba(15, 22, 32, 0.96);
    }

    @media (min-width: 768px) {
      .speech--with-portrait {
        background-image: linear-gradient(var(--sayit-border), var(--sayit-border));
        background-size: 2px 100%;
        background-position: 3.9% top;
        background-repeat: repeat-y;
      }

      .section-dot {
        background-color: rgba(162, 182, 199, 0.22);
        border-color: rgba(162, 182, 199, 0.22);
      }

      .speaker-list a:hover .speaker-card {
        border-color: var(--sayit-border-strong);
        box-shadow: 0 18px 32px rgba(0, 0, 0, 0.28);
        transform: translateY(-1px);
      }

      .section-navigation .speech-navigation__button {
        width: 100%;
        margin-right: 0;
      }
    }
  }
</style>`;

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
      var zh = /^zh\\b/i.test(navigator.language);
      root.classList.add(zh ? 'lang-zh' : 'lang-en');
      if (zh) document.addEventListener('DOMContentLoaded', function() {
        var map = {'Search': '搜尋', "Search this person's speeches": '搜尋此人的發言'};
        document.querySelectorAll('[placeholder]').forEach(function(el) {
          var zh_text = map[el.getAttribute('placeholder')];
          if (zh_text) el.setAttribute('placeholder', zh_text);
        });
      });
    })();
  </script>
  <style>
    .lang-zh [lang="en"] { display: none; }
    .lang-en [lang="zh"] { display: none; }
  </style>
  <title>${headTitle}</title>
  ${metaTags}
  ${inlineStyles}
  ${THEME_STYLES}
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
