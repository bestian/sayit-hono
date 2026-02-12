// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate } from "vue/server-renderer"


export default /*@__PURE__*/_defineComponent({
  __name: 'HomeView',
  __ssrInlineRender: true,
  props: {
    speechesCount: { type: String, required: false, default: '0' },
    speakersCount: { type: String, required: false, default: '0' },
    sectionsCount: { type: String, required: false, default: '0' }
  },
  setup(__props: any) {

const props = __props;

return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))} data-v-HomeView-ssr>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  _push(`<div class="full-page" data-v-HomeView-ssr><div class="full-page__row" data-v-HomeView-ssr><div class="full-page__unit" data-v-HomeView-ssr><div class="page-content__row" data-v-HomeView-ssr><div class="homepage-search" data-v-HomeView-ssr><h2 data-v-HomeView-ssr><span lang="zh" data-v-HomeView-ssr>搜尋對話與發言</span><span lang="en" data-v-HomeView-ssr>Search speeches and statements</span></h2><form class="site-search site-search--homepage" action="/search/" method="get" data-v-HomeView-ssr><div class="search-wrapper" data-v-HomeView-ssr><input type="search" class="site-search__input" placeholder="Search" name="q" data-v-HomeView-ssr><input type="submit" class="icon-search icon-search" value="Search" data-v-HomeView-ssr></div></form></div></div></div></div><div class="homepage-stats" data-v-HomeView-ssr><div class="full-page__row" data-v-HomeView-ssr><div class="full-page__unit" data-v-HomeView-ssr><a href="/speeches" data-v-HomeView-ssr><strong data-v-HomeView-ssr>${
    _ssrInterpolate(__props.speechesCount)
  }</strong></a> <span lang="zh" data-v-HomeView-ssr>篇對話</span><span lang="en" data-v-HomeView-ssr>speeches</span>; <a href="/speakers" data-v-HomeView-ssr><strong data-v-HomeView-ssr>${
    _ssrInterpolate(__props.speakersCount)
  }</strong></a> <span lang="zh" data-v-HomeView-ssr>位講者</span><span lang="en" data-v-HomeView-ssr>speakers</span>; <a href="/speeches" data-v-HomeView-ssr><strong data-v-HomeView-ssr>${
    _ssrInterpolate(__props.sectionsCount)
  }</strong></a> <span lang="zh" data-v-HomeView-ssr>個段落</span><span lang="en" data-v-HomeView-ssr>sections</span></div></div><div class="full-page__row" data-v-HomeView-ssr><div class="full-page__unit" data-v-HomeView-ssr></div></div></div></div>`)
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "\na[data-v-HomeView-ssr] {\n\tcursor: pointer !important;\n}\n";
