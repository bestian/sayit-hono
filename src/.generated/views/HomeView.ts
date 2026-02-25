// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent } from 'vue';
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttrs as _ssrRenderAttrs } from "vue/server-renderer"

export function ssrRender(_ctx, _push, _parent, _attrs) {
  const _component_Navbar = _resolveComponent("Navbar")
  const _component_Footer = _resolveComponent("Footer")

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))} data-v-HomeView-ssr>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  _push(`<div class="full-page" data-v-HomeView-ssr><div class="full-page__row" data-v-HomeView-ssr><div class="full-page__unit" data-v-HomeView-ssr><div class="page-content__row" data-v-HomeView-ssr><div class="homepage-search" data-v-HomeView-ssr><h2 data-v-HomeView-ssr><span lang="zh" data-v-HomeView-ssr>搜尋對話與發言</span><span lang="en" data-v-HomeView-ssr>Search speeches and statements</span></h2><div id="sayit-search" class="sayit-search sayit-search--homepage" role="search" data-v-HomeView-ssr><div class="sayit-search__input-wrap" data-v-HomeView-ssr><input id="sayit-search-input" type="search" class="sayit-search__input" autocomplete="off" spellcheck="false" aria-label="Search speeches" data-v-HomeView-ssr><span class="sayit-search__shortcut" id="sayit-search-shortcut" aria-hidden="true" data-v-HomeView-ssr>/</span></div></div></div></div><div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden data-v-HomeView-ssr></div></div></div><div class="homepage-stats" id="sayit-stats" data-v-HomeView-ssr><div class="full-page__row" data-v-HomeView-ssr><div class="full-page__unit" data-v-HomeView-ssr><a href="/speeches" data-v-HomeView-ssr><strong id="sayit-stat-speeches" data-v-HomeView-ssr></strong> <span lang="zh" data-v-HomeView-ssr>篇對話</span><span lang="en" data-v-HomeView-ssr>speeches</span></a>; <a href="/speakers" data-v-HomeView-ssr><strong id="sayit-stat-speakers" data-v-HomeView-ssr></strong> <span lang="zh" data-v-HomeView-ssr>位講者</span><span lang="en" data-v-HomeView-ssr>speakers</span></a></div></div></div></div>`)
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}

const _sfc_main = defineComponent({ name: 'HomeView' });
_sfc_main.ssrRender = ssrRender;

export const styles = "\n.sayit-search--homepage[data-v-HomeView-ssr] {\n\twidth: 100%;\n\tmax-width: 480px;\n}\n.sayit-search--homepage .sayit-search__input[data-v-HomeView-ssr] {\n\tfont-size: 1.05em;\n\tpadding: 0.55em 1em;\n\tpadding-right: 2.6em;\n}\na[data-v-HomeView-ssr] {\n\tcursor: pointer !important;\n}\n";
export default _sfc_main;
