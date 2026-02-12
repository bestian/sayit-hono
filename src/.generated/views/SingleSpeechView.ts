// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttr as _ssrRenderAttr, ssrRenderStyle as _ssrRenderStyle, ssrRenderClass as _ssrRenderClass, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate, ssrRenderList as _ssrRenderList } from "vue/server-renderer"

import { computed } from 'vue'
import { getSpeakerColor } from '../../utils/speakerColor'

interface Section {
  filename: string
  section_id: number
  previous_section_id: number | null
  next_section_id: number | null
  section_speaker: string | null
  section_content: string
  display_name: string
  photoURL: string | null
  name: string | null
}

const loading = false

export default /*@__PURE__*/_defineComponent({
  __name: 'SingleSpeechView',
  __ssrInlineRender: true,
  props: {
    sections: { type: Array, required: true },
    speechName: { type: String, required: true },
    displayName: { type: String, required: false }
  },
  setup(__props: any) {

const props = __props

const displaySections = computed(() => props.sections ?? [])
const formattedSpeechName = computed(() => {
  const firstSection = displaySections.value[0]
  if (firstSection?.display_name) {
    return firstSection.display_name
  }
  if (props.displayName) {
    return props.displayName
  }
  return props.speechName
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
})

const getLinkInContextUrl = (section: Section) =>
  `/${encodeURIComponent(section.filename)}#s${section.section_id}`

const getSpeechPageUrl = (sectionId: number) => `/speech/${sectionId}`

const getSpeakerUrl = (sectionSpeaker: string) => `/speaker/${sectionSpeaker}`

// 以 section_speaker（等同 route_pathname）決定顏色，與 SpeakersView 一致
const colorForSpeaker = (section: Section): string =>
	getSpeakerColor(section.section_speaker ?? section.name ?? '')

const borderStyle = (section: Section) =>
	section.section_speaker ? { borderLeftColor: colorForSpeaker(section) } : {}

const avatarStyle = (section: Section) => {
	const color = getSpeakerColor(section.section_speaker ?? '')
	return { borderColor: color, backgroundColor: color }
}

const sanitizeHtmlContent = (html: string): string => {
	// Remove script tags with various formats and replace with warning comment
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '<!-- Warning: there\'s an unexpected Script -->')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<!-- Warning: there\'s an unexpected Script -->')
		.replace(/<script[^>]*\/>/gi, '<!-- Warning: there\'s an unexpected Script -->');
}


return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))}>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  _push(`<div class="full-page"><div class="full-page__row"><div class="full-page__unit"><div class="page-header page-header--speech"><ul class="breadcrumbs"></ul>`)
  if (!loading && displaySections.value.length > 0 && displaySections.value[0]) {
    _push(`<h1>${_ssrInterpolate(displaySections.value[0].display_name)}</h1>`)
  } else {
    _push(`<h1>${_ssrInterpolate(formattedSpeechName.value)}</h1>`)
  }
  _push(`</div>`)
  if (!loading) {
    _push(`<div class="page-content__row"><div class="primary-content__unit"><ul class="section-list"><!--[-->`)
    _ssrRenderList(displaySections.value, (section) => {
      _push(`<li${
        _ssrRenderAttr("id", `s${section.section_id}`)
      } class="${
        _ssrRenderClass([
									'speech',
									'speech--',
									'speech--border',
									section.section_speaker ? 'speech--with-portrait' : ''
								])
      }" style="${
        _ssrRenderStyle(borderStyle(section))
      }">`)
      if (section.section_speaker) {
        _push(`<div class="speaker-portrait-wrapper"><img${
          _ssrRenderAttr("src", section.photoURL || '/static/speeches/i/a.png')
        } style="${
          _ssrRenderStyle(avatarStyle(section))
        }"${
          _ssrRenderAttr("alt", section.name || '')
        } class="speaker-portrait speaker-portrait--left round-image speaker-portrait--medium"></div>`)
      } else {
        _push(`<!---->`)
      }
      _push(`<div class="speech-wrapper">`)
      if (section.section_speaker && section.name) {
        _push(`<div class="speech__meta-data"><span class="speech__meta-data__speaker-name"><a${
          _ssrRenderAttr("href", getSpeakerUrl(section.section_speaker))
        }>${
          _ssrInterpolate(section.name)
        }</a></span></div>`)
      } else {
        _push(`<!---->`)
      }
      _push(`<div class="speech__content">${
        (sanitizeHtmlContent(section.section_content)) ?? ''
      }</div><div class="speech__links"><a${
        _ssrRenderAttr("href", getLinkInContextUrl(section))
      } title="Link in context"><i class="speech-icon icon-link-in-context"></i><span lang="zh">前後文</span><span lang="en">Link in context</span></a><a${
        _ssrRenderAttr("href", getSpeechPageUrl(section.section_id))
      } title="Link"><i class="speech-icon icon-link"></i><span lang="zh">連結</span><span lang="en">Link</span></a></div></div></li>`)
    })
    _push(`<!--]--></ul></div><!-- close primary-content__unit --><div class="sidebar__unit section-detail-sidebar"></div><!-- close sidebar__unit --></div>`)
  } else {
    _push(`<!---->`)
  }
  _push(`<!-- close page-content_row --></div></div></div>`)
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "";
