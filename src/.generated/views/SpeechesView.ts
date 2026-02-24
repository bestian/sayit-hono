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
  _push(`<div class="full-page"><div class="full-page__row"><div class="full-page__unit"><div class="page-header sayit-search-header"><h1><span lang="zh">對話</span><span lang="en">Speeches</span></h1><!-- Pagefind search widget --><div id="sayit-search" class="sayit-search" role="search"><div class="sayit-search__input-wrap"><input id="sayit-search-input" type="search" class="sayit-search__input" autocomplete="off" spellcheck="false" aria-label="Search speeches"><span class="sayit-search__shortcut" id="sayit-search-shortcut" aria-hidden="true">/</span></div></div></div><div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden></div><ul class="unstyled" id="sayit-speech-list"><!--[-->`)
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

export const styles = "\n/* Non-scoped: search results are rendered by client-side JS */\n.sayit-search-header {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 1em;\n\tflex-wrap: wrap;\n}\n.sayit-search-header h1 {\n\tmargin: 0;\n\tflex-shrink: 0;\n}\n.sayit-search {\n\tflex: 1 1 200px;\n\tmin-width: 0;\n\tmax-width: 400px;\n\tmargin: 0;\n}\n@media (max-width: 480px) {\n.sayit-search {\n\t\tflex-basis: 100%;\n\t\tmax-width: 100%;\n}\n}\n.sayit-search__input-wrap {\n\tposition: relative;\n\tmax-width: 100%;\n}\n.sayit-search__input {\n\tdisplay: block;\n\twidth: 100%;\n\tpadding: 0.45em 0.8em;\n\tpadding-right: 2.4em;\n\tfont-family: 'Noto Sans TC', sans-serif;\n\tfont-size: 0.9em;\n\tfont-weight: 400;\n\tline-height: 1.5;\n\tcolor: #2c2c2c;\n\tbackground: #fafaf8;\n\tborder: 1.5px solid #d4d0c8;\n\tborder-radius: 6px;\n\toutline: none;\n\ttransition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;\n\tbox-sizing: border-box;\n\t-webkit-appearance: none;\n}\n.sayit-search__input::placeholder {\n\tcolor: #9e998e;\n\tfont-weight: 300;\n}\n.sayit-search__input:focus {\n\tborder-color: #8b7e6a;\n\tbackground: #fff;\n\tbox-shadow: 0 0 0 3px rgba(139, 126, 106, 0.1);\n}\n\n/* WebKit search input reset */\n.sayit-search__input::-webkit-search-decoration,\n.sayit-search__input::-webkit-search-cancel-button {\n\t-webkit-appearance: none;\n}\n.sayit-search__shortcut {\n\tposition: absolute;\n\tright: 0.8em;\n\ttop: 50%;\n\ttransform: translateY(-50%);\n\tdisplay: inline-flex;\n\talign-items: center;\n\tjustify-content: center;\n\twidth: 1.6em;\n\theight: 1.6em;\n\tfont-family: monospace, 'Noto Sans TC', sans-serif;\n\tfont-size: 0.8em;\n\tfont-weight: 500;\n\tcolor: #a09888;\n\tbackground: #eeedea;\n\tborder: 1px solid #d8d4cc;\n\tborder-radius: 4px;\n\tpointer-events: none;\n\ttransition: opacity 0.25s ease;\n}\n\n/* Hide shortcut badge on touch devices */\n@media (hover: none) {\n.sayit-search__shortcut {\n\t\tdisplay: none;\n}\n}\n.sayit-search__results {\n\tmargin-top: 0.4em;\n\toverflow: hidden;\n}\n.sayit-search__results[hidden] {\n\tdisplay: none;\n}\n\n/* Fade-in animation for search results */\n.sayit-search__results-inner {\n\tanimation: sayit-fade-in 0.2s ease;\n}\n.sayit-search__status {\n\tpadding: 0.7em 0;\n\tfont-size: 0.85em;\n\tcolor: #9e998e;\n\tfont-weight: 300;\n\tletter-spacing: 0.01em;\n}\n.sayit-search__result {\n\tdisplay: block;\n\tpadding: 0.85em 0.5em;\n\tmargin: 0 -0.5em;\n\tborder-bottom: 1px solid #eeedea;\n\ttext-decoration: none;\n\tcolor: inherit;\n\tborder-radius: 4px;\n\ttransition: background 0.15s ease;\n}\n.sayit-search__result:last-of-type {\n\tborder-bottom: none;\n}\n.sayit-search__result:hover {\n\tbackground: #f5f4f0;\n}\n.sayit-search__result-title {\n\tfont-size: 1em;\n\tfont-weight: 500;\n\tcolor: #2c2c2c;\n\tline-height: 1.45;\n\tmargin: 0;\n\tword-break: break-word;\n}\n.sayit-search__result:hover .sayit-search__result-title {\n\tcolor: #3a7d5c;\n}\n.sayit-search__result-meta {\n\tdisplay: flex;\n\tflex-wrap: wrap;\n\talign-items: center;\n\tgap: 0.5em;\n\tmargin-top: 0.2em;\n\tfont-size: 0.8em;\n\tcolor: #a09888;\n\tfont-weight: 400;\n}\n.sayit-search__result-excerpt {\n\tmargin-top: 0.3em;\n\tfont-size: 0.88em;\n\tline-height: 1.65;\n\tcolor: #5a5650;\n\tfont-weight: 400;\n\tword-break: break-word;\n\toverflow-wrap: break-word;\n}\n.sayit-search__result-excerpt mark {\n\tbackground: rgba(201, 180, 120, 0.3);\n\tcolor: inherit;\n\tpadding: 0.05em 0.15em;\n\tborder-radius: 2px;\n\tfont-weight: 500;\n}\n.sayit-search__loading {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 0.6em;\n\tpadding: 0.8em 0;\n\tfont-size: 0.85em;\n\tcolor: #9e998e;\n\tfont-weight: 300;\n}\n.sayit-search__spinner {\n\twidth: 0.9em;\n\theight: 0.9em;\n\tborder: 1.5px solid #e0ddd6;\n\tborder-top-color: #8b7e6a;\n\tborder-radius: 50%;\n\tanimation: sayit-spin 0.6s linear infinite;\n}\n.sayit-search__more {\n\tdisplay: block;\n\tpadding: 0.75em 0 0.25em;\n\tfont-size: 0.85em;\n\tcolor: #8b7e6a;\n\ttext-decoration: none;\n\ttext-align: center;\n\ttransition: color 0.15s ease;\n}\n.sayit-search__more:hover {\n\tcolor: #3a7d5c;\n\ttext-decoration: underline;\n}\n@keyframes sayit-spin {\nto { transform: rotate(360deg);\n}\n}\n@keyframes sayit-fade-in {\nfrom { opacity: 0; transform: translateY(-4px);\n}\nto { opacity: 1; transform: translateY(0);\n}\n}\n\n/* Mobile: prevent iOS zoom on focus */\n@media (max-width: 640px) {\n.sayit-search__input {\n\t\tfont-size: 16px;\n}\n}\n";
