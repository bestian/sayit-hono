// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttr as _ssrRenderAttr, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate, ssrRenderList as _ssrRenderList } from "vue/server-renderer"

import { computed } from 'vue';

type NestedItem = {
	nest_filename: string;
	nest_display_name: string;
	section_count?: number;
	preview?: string;
};


export default /*@__PURE__*/_defineComponent({
  __name: 'NestedSpeechView',
  __ssrInlineRender: true,
  props: {
    nests: { type: Array, required: true },
    speechName: { type: String, required: true },
    displayName: { type: String, required: true }
  },
  setup(__props: any) {

const props = __props;

const nestedList = computed(() => props.nests ?? []);

const getNestUrl = (nestFilename: string) =>
	`/${encodeURIComponent(props.speechName)}/${encodeURIComponent(nestFilename)}`;

return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))}>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  _push(`<div class="full-page"><div class="full-page__row"><div class="full-page__unit"><div class="page-header page-header--speech"><ul class="breadcrumbs"></ul><h1>${_ssrInterpolate(__props.displayName)}</h1></div><div class="page-content__row"><div class="primary-content__unit"><ul class="section-list"><!--[-->`)
  _ssrRenderList(nestedList.value, (nest) => {
    _push(`<li class="speech speech--section-signpost speech--with-portrait"><div class="speaker-portrait-wrapper"><span class="section-dot"></span></div><div class="speech-wrapper"><span class="section-title"><a${
      _ssrRenderAttr("href", getNestUrl(nest.nest_filename))
    }>${
      _ssrInterpolate(nest.nest_display_name || nest.nest_filename)
    }</a></span>`)
    if (nest.section_count) {
      _push(`<!--[--> (${_ssrInterpolate(nest.section_count)})<!--]-->`)
    } else {
      _push(`<!---->`)
    }
    _push(`</div></li>`)
  })
  _push(`<!--]--></ul></div><div class="sidebar__unit section-detail-sidebar"></div></div></div></div></div>`)
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "";
