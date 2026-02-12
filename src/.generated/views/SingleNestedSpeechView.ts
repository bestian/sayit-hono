// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttr as _ssrRenderAttr, ssrRenderStyle as _ssrRenderStyle, ssrRenderClass as _ssrRenderClass, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate, ssrRenderList as _ssrRenderList } from "vue/server-renderer"

import { computed } from 'vue';
	import { getSpeakerColor } from '../../utils/speakerColor';

	interface Section {
		filename: string;
		nest_filename: string | null;
		nest_display_name: string | null;
		section_id: number;
		previous_section_id: number | null;
		next_section_id: number | null;
		section_speaker: string | null;
		section_content: string;
		display_name: string;
		photoURL: string | null;
		name: string | null;
	}

	type SiblingNest = {
		nest_filename: string;
		nest_display_name?: string | null;
	};

	const loading = false;
	
export default /*@__PURE__*/_defineComponent({
  __name: 'SingleNestedSpeechView',
  __ssrInlineRender: true,
  props: {
    sections: { type: Array, required: true },
    speechName: { type: String, required: true },
    nestFilename: { type: String, required: true },
    displayName: { type: String, required: false },
    speechDisplayName: { type: String, required: false },
    siblings: { type: Array, required: false }
  },
  setup(__props: any) {

	const props = __props;

	const displaySections = computed(() => props.sections ?? []);

	const formattedTitle = computed(() => {
		if (props.displayName) return props.displayName;
		const firstSection = displaySections.value[0];
		if (firstSection?.nest_display_name) return firstSection.nest_display_name;
		return props.nestFilename;
	});

	const formattedParentTitle = computed(() => {
		if (props.speechDisplayName) return props.speechDisplayName;
		const firstSection = displaySections.value[0];
		if (firstSection?.display_name) return firstSection.display_name;
		return props.speechName;
	});

	const formattedPreviousSiblingTitle = computed(() => {
		if (previousSibling.value?.nest_display_name) return previousSibling.value.nest_display_name;
		return previousSibling.value?.nest_filename;
	});
	const formattedNextSiblingTitle = computed(() => {
		if (nextSibling.value?.nest_display_name) return nextSibling.value.nest_display_name;
		return nextSibling.value?.nest_filename;
	});

	const getLinkInContextUrl = (section: Section) =>
		`/${encodeURIComponent(section.filename)}/${encodeURIComponent(props.nestFilename)}#s${section.section_id}`;

	const getSpeechPageUrl = (sectionId: number) => `/speech/${sectionId}`;

	const getSpeakerUrl = (sectionSpeaker: string) => `/speaker/${sectionSpeaker}`;

	const getNestListUrl = () => `/${encodeURIComponent(props.speechName)}`;

	const colorForSpeaker = (section: Section): string => {
		const key =
			section.section_speaker ||
			section.name ||
			section.filename ||
			(section.display_name ?? '')
		return getSpeakerColor(key);
	};

	const borderStyle = (section: Section) =>
		section.section_speaker ? { borderLeftColor: colorForSpeaker(section) } : {};

	const avatarStyle = (section: Section) => {
		const color = colorForSpeaker(section);
		return { borderColor: color, backgroundColor: color };
	};

	const siblingList = computed(() => props.siblings ?? []);
	const currentSiblingIndex = computed(() =>
		siblingList.value.findIndex((item) => item.nest_filename === props.nestFilename)
	);
	const previousSibling = computed(() =>
		currentSiblingIndex.value > 0 ? siblingList.value[currentSiblingIndex.value - 1] : null
	);
	const nextSibling = computed(() =>
		currentSiblingIndex.value >= 0 && currentSiblingIndex.value < siblingList.value.length - 1
			? siblingList.value[currentSiblingIndex.value + 1]
			: null
	);

	const getNestUrl = (nestFilename: string) =>
		`/${encodeURIComponent(props.speechName)}/${encodeURIComponent(nestFilename)}`;

	const sanitizeHtmlContent = (html: string): string => {
		// Remove script tags with various formats and replace with warning comment
		return html
			.replace(/<script[\s\S]*?<\/script>/gi, '<!-- Warning: there\'s an unexpected Script -->')
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<!-- Warning: there\'s an unexpected Script -->')
			.replace(/<script[^>]*\/>/gi, '<!-- Warning: there\'s an unexpected Script -->');
	};

	
return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))} data-v-SingleNestedSpeechView-ssr>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  _push(`<div class="full-page" data-v-SingleNestedSpeechView-ssr><div class="full-page__row" data-v-SingleNestedSpeechView-ssr><div class="full-page__unit" data-v-SingleNestedSpeechView-ssr><div class="page-header page-header--speech" data-v-SingleNestedSpeechView-ssr><ul class="breadcrumbs" data-v-SingleNestedSpeechView-ssr><li data-v-SingleNestedSpeechView-ssr><a${
    _ssrRenderAttr("href", getNestListUrl())
  } data-v-SingleNestedSpeechView-ssr>${
    _ssrInterpolate(formattedParentTitle.value)
  }</a></li></ul><h1 data-v-SingleNestedSpeechView-ssr>${
    _ssrInterpolate(formattedTitle.value)
  }</h1></div>`)
  if (!loading) {
    _push(`<div class="page-content__row" data-v-SingleNestedSpeechView-ssr><div class="primary-content__unit" data-v-SingleNestedSpeechView-ssr><ul class="section-list" data-v-SingleNestedSpeechView-ssr><!--[-->`)
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
      }" data-v-SingleNestedSpeechView-ssr>`)
      if (section.section_speaker) {
        _push(`<div class="speaker-portrait-wrapper" data-v-SingleNestedSpeechView-ssr><img${
          _ssrRenderAttr("src", section.photoURL || '/static/speeches/i/a.png')
        }${
          _ssrRenderAttr("alt", section.name || '')
        } style="${
          _ssrRenderStyle(avatarStyle(section))
        }" class="speaker-portrait speaker-portrait--left round-image speaker-portrait--medium" data-v-SingleNestedSpeechView-ssr></div>`)
      } else {
        _push(`<!---->`)
      }
      _push(`<div class="speech-wrapper" data-v-SingleNestedSpeechView-ssr><div class="speech__meta-data" data-v-SingleNestedSpeechView-ssr>`)
      if (section.section_speaker && section.name) {
        _push(`<span class="speech__meta-data__speaker-name" data-v-SingleNestedSpeechView-ssr><a${
          _ssrRenderAttr("href", getSpeakerUrl(section.section_speaker))
        } data-v-SingleNestedSpeechView-ssr>${
          _ssrInterpolate(section.name)
        }</a></span>`)
      } else {
        _push(`<!---->`)
      }
      _push(`</div><div class="speech__content" data-v-SingleNestedSpeechView-ssr>${
        (sanitizeHtmlContent(section.section_content)) ?? ''
      }</div><div class="speech__links" data-v-SingleNestedSpeechView-ssr><a${
        _ssrRenderAttr("href", getLinkInContextUrl(section))
      } title="Link in context" data-v-SingleNestedSpeechView-ssr><i class="speech-icon icon-link-in-context" data-v-SingleNestedSpeechView-ssr></i><span lang="zh" data-v-SingleNestedSpeechView-ssr>前後文</span><span lang="en" data-v-SingleNestedSpeechView-ssr>Link in context</span></a><a${
        _ssrRenderAttr("href", getSpeechPageUrl(section.section_id))
      } title="Link" data-v-SingleNestedSpeechView-ssr><i class="speech-icon icon-link" data-v-SingleNestedSpeechView-ssr></i><span lang="zh" data-v-SingleNestedSpeechView-ssr>連結</span><span lang="en" data-v-SingleNestedSpeechView-ssr>Link</span></a></div></div></li>`)
    })
    _push(`<!--]--></ul></div><!-- close primary-content__unit --><div class="sidebar__unit section-detail-sidebar" data-v-SingleNestedSpeechView-ssr><div class="section-navigation" data-v-SingleNestedSpeechView-ssr>`)
    if (previousSibling.value) {
      _push(`<a class="button speech-navigation__button"${
        _ssrRenderAttr("href", getNestUrl(previousSibling.value.nest_filename))
      } data-prev-btn data-v-SingleNestedSpeechView-ssr> ← ${
        _ssrInterpolate(formattedPreviousSiblingTitle.value)
      }</a>`)
    } else {
      _push(`<!---->`)
    }
    if (nextSibling.value) {
      _push(`<a class="button speech-navigation__button"${
        _ssrRenderAttr("href", getNestUrl(nextSibling.value.nest_filename))
      } data-next-btn data-v-SingleNestedSpeechView-ssr>${
        _ssrInterpolate(formattedNextSiblingTitle.value)
      } → </a>`)
    } else {
      _push(`<!---->`)
    }
    _push(`</div><div class="ui-instructions cleared" data-v-SingleNestedSpeechView-ssr><h2 data-v-SingleNestedSpeechView-ssr><span lang="zh" data-v-SingleNestedSpeechView-ssr>鍵盤快捷鍵</span><span lang="en" data-v-SingleNestedSpeechView-ssr>Keyboard shortcuts</span></h2><p data-v-SingleNestedSpeechView-ssr><span class="key-descriptor" data-v-SingleNestedSpeechView-ssr>j</span> <span lang="zh" data-v-SingleNestedSpeechView-ssr>下一段</span><span lang="en" data-v-SingleNestedSpeechView-ssr>next section</span><span class="key-descriptor" data-v-SingleNestedSpeechView-ssr>k</span> <span lang="zh" data-v-SingleNestedSpeechView-ssr>上一段</span><span lang="en" data-v-SingleNestedSpeechView-ssr>previous section</span></p></div></div></div>`)
  } else {
    _push(`<!---->`)
  }
  _push(`</div></div></div>`)
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "\n.breadcrumbs[data-v-SingleNestedSpeechView-ssr] {\n\t\tmargin: 0 0 0.5rem;\n}\n\t";
