// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent } from 'vue';
import { mergeProps as _mergeProps } from "vue"
import { ssrRenderAttrs as _ssrRenderAttrs } from "vue/server-renderer"

export function ssrRender(_ctx, _push, _parent, _attrs) {
  _push(`<header${_ssrRenderAttrs(_mergeProps({ class: "full-page__row navbar" }, _attrs))}><div class="full-page__unit"><h1><a href="/">SayIt</a></h1><ul class="inline-list left"><li><a href="/"><span lang="zh">首頁</span><span lang="en">Home</span></a></li><li><a href="/speakers"><span lang="zh">講者</span><span lang="en">Speakers</span></a></li><li><a href="/speeches"><span lang="zh">對話</span><span lang="en">Speeches</span></a></li></ul><ul class="unstyled-list right"></ul></div></header>`)
}

const _sfc_main = defineComponent({ name: 'Navbar' });
_sfc_main.ssrRender = ssrRender;

export const styles = "";
export default _sfc_main;
