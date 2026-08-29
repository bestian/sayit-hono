import { createSSRApp, type Component } from 'vue';
import { renderToString } from '@vue/server-renderer';
import type { HeadSpec } from './heads';
import { escapeHtml } from '../utils/textUtils';
import designStyles from '../styles/design.css?raw';

const BASE_HEAD = `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3f6f6">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#101a1f">
  <meta name="color-scheme" content="light dark">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta property="og:site_name" content="SayIt">
  <meta property="og:type" content="website">
  <meta name="google-site-verification" content="DiXRH7TWCHjMPvi1kvFkDgwpHBGkbFkR2Rxki-iGh2o">
  <link rel="preconnect" href="https://ds.justfont.com" crossorigin>
  <script src="/static/speeches/js/justfont-loader.js"></script>`;

const DESIGN_STYLES = `<style>${designStyles}</style>`;

const SHARE_SCRIPT = `<script>
  (function() {
    var toastTimer = 0;

    function isZh() {
      return document.documentElement.classList.contains('lang-zh') || /^zh\\b/i.test(navigator.language || '');
    }

    function getToast() {
      return document.getElementById('sayit-share-feedback');
    }

    function showToast(message) {
      var toast = getToast();
      if (!toast) return;
      toast.textContent = message;
      toast.hidden = false;
      toast.classList.add('is-visible');
      if (toastTimer) {
        window.clearTimeout(toastTimer);
      }
      toastTimer = window.setTimeout(function() {
        toast.classList.remove('is-visible');
        toast.hidden = true;
      }, 2200);
    }

    function resolveUrl(button) {
      var raw = button && button.getAttribute('data-share-url');
      var value = raw || window.location.href;
      try {
        return new URL(value, window.location.href).toString();
      } catch (error) {
        return window.location.href;
      }
    }

    async function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }

      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        var copied = document.execCommand('copy');
        if (!copied) {
          throw new Error('Copy command failed');
        }
      } finally {
        document.body.removeChild(textarea);
      }
    }

    async function share(button) {
      var title = (button && button.getAttribute('data-share-title')) || document.title || 'SayIt';
      var url = resolveUrl(button);
      var menu = button && button.closest ? button.closest('details.turnline__share-menu') : null;

      if (navigator.share) {
        try {
          await navigator.share({ title: title, url: url });
          if (menu) menu.removeAttribute('open');
          return;
        } catch (error) {
          if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
            return;
          }
        }
      }

      try {
        await copyText(url);
        if (menu) menu.removeAttribute('open');
        showToast(isZh() ? '連結已複製' : 'Link copied');
      } catch (error) {
        if (menu) menu.removeAttribute('open');
        window.prompt(isZh() ? '請複製這個連結' : 'Copy this link', url);
      }
    }

    document.addEventListener('click', function(event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var button = target.closest('[data-sayit-share]');
      var clickedMenu = target.closest('details.turnline__share-menu');
      document.querySelectorAll('details.turnline__share-menu[open]').forEach(function(menu) {
        if (menu !== clickedMenu) menu.removeAttribute('open');
      });
      if (!button) return;
      event.preventDefault();
      void share(button);
    });

    document.addEventListener('keydown', function(event) {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('details.turnline__share-menu[open]').forEach(function(menu) {
        menu.removeAttribute('open');
        var summary = menu.querySelector('summary');
        if (summary) summary.focus();
      });
    });
  })();
</script>`;

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
				return `<meta property="${escapeHtml(meta.property)}" content="${escapeHtml(meta.content)}">`;
			}
			if (meta.name) {
				return `<meta name="${escapeHtml(meta.name)}" content="${escapeHtml(meta.content)}">`;
			}
			return '';
		})
		.filter(Boolean)
		.join('\n  ');
}

function renderLinks(head?: HeadSpec) {
	const entries = head?.links ?? [];
	return entries
		.map((link) => {
			const attrs = [`rel="${escapeHtml(link.rel)}"`, `href="${escapeHtml(link.href)}"`];
			if (link.hreflang) attrs.push(`hreflang="${escapeHtml(link.hreflang)}"`);
			return `<link ${attrs.join(' ')}>`;
		})
		.filter(Boolean)
		.join('\n  ');
}

function wrapHtml(appHtml: string, { title, styles, head, scripts }: RenderOptions) {
	const headTitle = escapeHtml(head?.title ?? (title ? `${title} :: SayIt` : 'SayIt'));
	const inlineStyles = styles?.trim() ? `<style>${styles}</style>` : '';
	const metaTags = renderMeta(head);
	const linkTags = renderLinks(head);
	const extraScripts = `  ${[SHARE_SCRIPT, scripts?.trim() ?? ''].filter(Boolean).join('\n  ')}`;

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
      var stored = null;
      try { stored = localStorage.getItem('sayit-ui-lang'); } catch (e) {}
      var zh = stored === 'zh' || stored === 'en' ? stored === 'zh' : /^zh\b/i.test(navigator.language || '');
      root.classList.remove('lang-zh', 'lang-en');
      root.classList.add(zh ? 'lang-zh' : 'lang-en');
      root.lang = zh ? 'zh-Hant' : 'en';
      function applyPlaceholders(useZh) {
        var pairs = [
          ['Search', '搜尋'],
          ["Search this person's speeches", '搜尋此人的發言'],
          ['Search this speaker’s words', '搜尋此講者的原話'],
          ['Search speeches…', '搜尋對話內容…'],
          ['Search speeches', '搜尋對話'],
          ['Search speakers or exact words', '搜尋講者或原話'],
          ['Search exact words, speakers, or sections', '搜尋原話、講者或對話'],
          ['Try a phrase or speaker’s name…', '輸入原話或講者…']
        ];
        document.querySelectorAll('[placeholder]').forEach(function(el) {
          var current = el.getAttribute('placeholder');
          for (var i = 0; i < pairs.length; i++) {
            if (current === pairs[i][0] || current === pairs[i][1]) {
              el.setAttribute('placeholder', useZh ? pairs[i][1] : pairs[i][0]);
              break;
            }
          }
        });
      }
      function markCurrentNavigation() {
        var path = window.location.pathname;
        document.querySelectorAll('.site-nav a').forEach(function(link) {
          var target = new URL(link.href, window.location.href).pathname;
          if (path === target || path.indexOf(target) === 0) link.setAttribute('aria-current', 'page');
        });
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markCurrentNavigation);
      else markCurrentNavigation();
      if (zh) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { applyPlaceholders(true); });
        else applyPlaceholders(true);
      }
      document.addEventListener('click', function(e) {
        var btn = e.target && e.target.closest ? e.target.closest('#sayit-site-lang-toggle') : null;
        if (!btn) return;
        var nextZh = !root.classList.contains('lang-zh');
        root.classList.remove('lang-zh', 'lang-en');
        root.classList.add(nextZh ? 'lang-zh' : 'lang-en');
        root.lang = nextZh ? 'zh-Hant' : 'en';
        try { localStorage.setItem('sayit-ui-lang', nextZh ? 'zh' : 'en'); } catch (err) {}
        window.dispatchEvent(new CustomEvent('sayit-lang-change', { detail: { zh: nextZh } }));
        applyPlaceholders(nextZh);
      });
    })();
  </script>
  <style>
    .lang-zh [lang="en"] { display: none; }
    .lang-en [lang="zh"] { display: none; }
    .lang-zh .record-copy[lang="en"],
    .lang-zh .record-copy [lang="en"],
    .lang-zh .record-twin-button[lang="en"] { display: revert !important; }
  </style>
  <title>${headTitle}</title>
  ${metaTags}
  ${linkTags}
  ${inlineStyles}
  ${DESIGN_STYLES}
</head>
<body id="top">
  <div id="app">${appHtml}</div>
${extraScripts}
</body>
</html>`;
}

export async function renderHtml(component: Component, { title, styles, components, props, head, scripts }: RenderOptions) {
	const app = createSSRApp(component, props);

	if (components) {
		for (const [name, instance] of Object.entries(components)) {
			app.component(name, instance);
		}
	}

	const appHtml = await renderToString(app);
	return wrapHtml(appHtml, { title, styles, head, scripts });
}
