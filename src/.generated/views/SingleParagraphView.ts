// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, unref as _unref, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttr as _ssrRenderAttr, ssrRenderStyle as _ssrRenderStyle, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate } from "vue/server-renderer"

import { getSpeakerColor } from '../../utils/speakerColor'

type Section = {
	filename: string;
	section_id: number;
	section_speaker: string | null;
	section_content: string;
	previous_section_id: number | null;
	next_section_id: number | null;
	display_name: string;
	photoURL: string | null;
	name: string | null;
	previous_content: string | null;
	next_content: string | null;
};


export default /*@__PURE__*/_defineComponent({
  __name: 'SingleParagraphView',
  __ssrInlineRender: true,
  props: {
    section: { type: Object, required: true }
  },
  setup(__props: any) {

const props = __props;

const speakerColor = getSpeakerColor(
	props.section?.section_speaker ||
	props.section?.name ||
	props.section?.filename ||
	''
);
const avatarStyle = { borderColor: speakerColor, backgroundColor: speakerColor };

function parseContent(raw?: string | null) {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'string' ? parsed : raw;
	} catch {
		return raw;
	}
}

function stripHtmlTags(html: string): string {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeHtmlContent(html: string): string {
	// Remove script tags with various formats and replace with warning comment
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '<!-- Warning: there\'s an unexpected Script -->')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<!-- Warning: there\'s an unexpected Script -->')
		.replace(/<script[^>]*\/>/gi, '<!-- Warning: there\'s an unexpected Script -->');
}

const parsedContent = sanitizeHtmlContent(parseContent(props.section?.section_content));
const previousTextPreview = props.section?.previous_content
	? stripHtmlTags(parseContent(props.section.previous_content)).slice(0, 30)
	: '';
const nextTextPreview = props.section?.next_content
	? stripHtmlTags(parseContent(props.section.next_content)).slice(0, 30)
	: '';

const getSpeakerUrl = (route_pathname: string | null) => (route_pathname ? `/speaker/${route_pathname}` : '#');
const getSpeechUrl = (filename: string) => `/${encodeURIComponent(filename)}`;
const getContextUrl = (filename: string, sectionId: number) => `/${encodeURIComponent(filename)}#s${sectionId}`;
const getParagraphUrl = (sectionId: number) => `/speech/${sectionId}`;

return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))}>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  if (__props.section) {
    _push(`<div class="full-page"><div class="full-page__row"><div class="full-page__unit"><div class="single-speech-layout"><div class="single-speech-layout__speech-column"><div class="speech speech-single-speech">`)
    if (__props.section.section_speaker) {
      _push(`<a class="speech-single-speech__speaker-portrait"${
        _ssrRenderAttr("href", getSpeakerUrl(__props.section.section_speaker))
      }><img${
        _ssrRenderAttr("src", __props.section.photoURL || '/static/speeches/i/a.png')
      } style="${
        _ssrRenderStyle(avatarStyle)
      }"${
        _ssrRenderAttr("alt", __props.section.name || '')
      } class="speaker-portrait speaker-portrait--left round-image speaker-portrait--large"></a>`)
    } else {
      _push(`<!---->`)
    }
    _push(`<div class="speech__meta-data"><span class="speech__meta-data__speech-type"><span lang="zh">發言</span><span lang="en">Speech</span></span>`)
    if (__props.section.section_speaker && __props.section.name) {
      _push(`<span><span lang="en">by</span><span class="speech__meta-data__speaker-name"><a${
        _ssrRenderAttr("href", getSpeakerUrl(__props.section.section_speaker))
      }>${
        _ssrInterpolate(__props.section.name)
      }</a></span></span>`)
    } else {
      _push(`<!---->`)
    }
    _push(`</div><div class="speech__content speech__content-single-speech">${(_unref(parsedContent)) ?? ''}</div>`)
    if (__props.section.filename) {
      _push(`<ul class="breadcrumbs"><li><a${
        _ssrRenderAttr("href", getSpeechUrl(__props.section.filename))
      }>${
        _ssrInterpolate(__props.section.display_name)
      }</a></li></ul>`)
    } else {
      _push(`<!---->`)
    }
    if (__props.section.filename && __props.section.section_id) {
      _push(`<div class="speech__links"><a${_ssrRenderAttr("href", getContextUrl(__props.section.filename, __props.section.section_id))}><i class="speech-icon icon-link-in-context"></i><span lang="zh">顯示前後文</span><span lang="en">Show context</span></a></div>`)
    } else {
      _push(`<!---->`)
    }
    _push(`</div><div class="speech-navigation"><div class="speech-navigation__column speech-navigation__column--one">`)
    if (__props.section.previous_section_id) {
      _push(`<a${_ssrRenderAttr("href", getParagraphUrl(__props.section.previous_section_id))} class="button speech-navigation__button">`)
      if (_unref(previousTextPreview)) {
        _push(`<!--[--> ← ${_ssrInterpolate(_unref(previousTextPreview))}... <!--]-->`)
      } else {
        _push(`<!--[--> ← （... <!--]-->`)
      }
      _push(`</a>`)
    } else {
      _push(`<!---->`)
    }
    if (__props.section.next_section_id) {
      _push(`<a${_ssrRenderAttr("href", getParagraphUrl(__props.section.next_section_id))} class="button speech-navigation__button">`)
      if (_unref(nextTextPreview)) {
        _push(`<!--[-->${_ssrInterpolate(_unref(nextTextPreview))}... → <!--]-->`)
      } else {
        _push(`<!--[--> （... → <!--]-->`)
      }
      _push(`</a>`)
    } else {
      _push(`<!---->`)
    }
    _push(`</div><div class="speech-navigation__column speech-navigation__column--two"><div class="ui-instructions" id="keyboard-shortcuts"${
      _ssrRenderAttr("data-prev-url", __props.section.previous_section_id ? getParagraphUrl(__props.section.previous_section_id) : '')
    }${
      _ssrRenderAttr("data-next-url", __props.section.next_section_id ? getParagraphUrl(__props.section.next_section_id) : '')
    }><h2><span lang="zh">鍵盤快捷鍵</span><span lang="en">Keyboard shortcuts</span></h2><p><span class="key-descriptor">j</span> <span lang="zh">下一段</span><span lang="en">next speech</span><span class="key-descriptor">k</span> <span lang="zh">上一段</span><span lang="en">previous speech</span></p></div></div></div></div></div></div></div></div>`)
  } else {
    _push(`<!---->`)
  }
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "";
