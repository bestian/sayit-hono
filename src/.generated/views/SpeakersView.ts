// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttr as _ssrRenderAttr, ssrRenderStyle as _ssrRenderStyle, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate, ssrRenderList as _ssrRenderList } from "vue/server-renderer"

import { computed } from 'vue'
import { getSpeakerColor } from '../../utils/speakerColor'
import { headForSpeakers } from '../ssr/heads'

interface Speaker {
  id: number,
  route_pathname: string,
  name: string,
  photoURL: string | null
}


export default /*@__PURE__*/_defineComponent({
  __name: 'SpeakersView',
  __ssrInlineRender: true,
  props: {
    speakers: { type: Array, required: false }
  },
  setup(__props: any) {

const props = __props
const speakers = computed<Speaker[]>(() => props.speakers ?? [])

const colorStyle = (route: string, name?: string) => {
	const color = getSpeakerColor(route || name || '')
	return { borderColor: color, backgroundColor: color }
}


return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))}>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  _push(`<div class="full-page"><div class="full-page__row"><div class="full-page__unit"><div class="page-header"><h1>All Speakers</h1></div><form class="site-search site-search--on-results-page" action="/search/" method="get"><div class="search-wrapper"><input type="search" class="site-search__input" placeholder="Search" name="q"><input type="submit" class="icon-search" value="Search"></div></form><ul class="speaker-list"><!--[-->`)
  _ssrRenderList(speakers.value, (speaker) => {
    _push(`<li><a${
      _ssrRenderAttr("href", '/speaker/' + speaker.route_pathname)
    }><div class="speaker-card"><img${
      _ssrRenderAttr("src", speaker.photoURL || '/static/speeches/i/a.png')
    } style="${
      _ssrRenderStyle(colorStyle(speaker.route_pathname, speaker.name))
    }"${
      _ssrRenderAttr("alt", speaker.name || 'Speaker Photo')
    } class="speaker-card__portrait speaker-portrait round-image speaker-portrait--small"><span class="speaker-card__name">${
      _ssrInterpolate(speaker.name || 'Speaker')
    }</span></div></a></li>`)
  })
  _push(`<!--]--></ul></div></div></div>`)
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "";
