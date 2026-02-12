// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttr as _ssrRenderAttr, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate, ssrRenderList as _ssrRenderList } from "vue/server-renderer"

import { computed } from 'vue';

interface SpeechItem {
	filename: string;
	display_name: string;
}


export default /*@__PURE__*/_defineComponent({
  __name: 'SpeechesView',
  __ssrInlineRender: true,
  props: {
    speeches: { type: Array, required: true },
    source: { type: String, required: false }
  },
  setup(__props: any) {

const props = __props;

// 從 display_name 提取日期（格式：YYYY-MM-DD）
function extractDate(displayName: string): string {
	const match = displayName.match(/^(\d{4}-\d{2}-\d{2})/);
	return match ? match[1] : '';
}

// 按日期降序排序（新的在前）
const sortedSpeeches = computed(() => {
	return [...props.speeches].sort((a, b) => {
		const dateA = extractDate(a.display_name);
		const dateB = extractDate(b.display_name);

		// 如果都有日期，按日期降序排序
		if (dateA && dateB) {
			return dateB.localeCompare(dateA);
		}

		// 如果只有一個有日期，有日期的排在前面
		if (dateA && !dateB) return -1;
		if (!dateA && dateB) return 1;

		// 都沒有日期，保持原順序
		return 0;
	});
});

return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))}>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  _push(`<div class="full-page"><div class="full-page__row"><div class="full-page__unit"><div class="page-header"><h1><span lang="zh">對話</span><span lang="en">Speeches</span></h1></div><ul class="unstyled"><!--[-->`)
  _ssrRenderList(sortedSpeeches.value, (speech) => {
    _push(`<li><span class="section-title"><a${
      _ssrRenderAttr("href", `/${encodeURIComponent(speech.filename)}`)
    }>${
      _ssrInterpolate(speech.display_name)
    }</a></span></li>`)
  })
  _push(`<!--]--></ul></div></div></div>`)
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "";
