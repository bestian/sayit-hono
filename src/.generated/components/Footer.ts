// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent } from 'vue';
import { mergeProps as _mergeProps } from "vue"
import { ssrRenderStyle as _ssrRenderStyle, ssrRenderAttrs as _ssrRenderAttrs } from "vue/server-renderer"

export function ssrRender(_ctx, _push, _parent, _attrs) {
  _push(`<footer${
    _ssrRenderAttrs(_mergeProps({ class: "full-page__row" }, _attrs))
  }><div class="full-page__unit" style="${
    _ssrRenderStyle({"display":"flex"})
  }"><div class="row"><div class="columns small-12 large-9" style="${
    _ssrRenderStyle({"padding":"0"})
  }"><p style="${
    _ssrRenderStyle({"font-size":"1em","font-weight":"bold","display":"flex","margin-inline-end":"auto"})
  }" id="cc"><span lang="zh">本站由 唐鳳 與 唐宗浩 共同維運，除另有標示外，內容以創用 CC0 授權條款釋出</span><span lang="en">This site is co-maintained by Audrey Tang and Bestian Tang. Unless otherwise indicated, the content is released under the terms of the Creative Commons CC0 license.</span></p></div><div class="columns small-12 large-3" style="${
    _ssrRenderStyle({"padding":"0"})
  }"><p style="${
    _ssrRenderStyle({"font-size":"1em","font-weight":"bold","display":"flex","justify-content":"end"})
  }"><a id="tos"></a><a id="privacy" style="${
    _ssrRenderStyle({"margin-left":"1rem"})
  }"></a></p></div></div></div></footer>`)
}

const _sfc_main = defineComponent({ name: 'Footer' });
_sfc_main.ssrRender = ssrRender;

export const styles = "";
export default _sfc_main;
