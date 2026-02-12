// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttr as _ssrRenderAttr, ssrRenderStyle as _ssrRenderStyle, ssrRenderClass as _ssrRenderClass, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate, ssrRenderList as _ssrRenderList } from "vue/server-renderer"

import { computed,  ref } from 'vue'
import { getSpeakerColor } from '../../utils/speakerColor'

interface ApiSection {
  filename: string
  display_name: string
  section_id: number
  previous_section_id: number | null
  next_section_id: number | null
  section_speaker: string | null
  section_content: string
}

interface Section extends ApiSection {
  summary: string
}

interface ApiLongestSection {
  section_id: number
  section_content: string
  section_filename: string
  section_display_name: string
}

interface LongestSection extends ApiLongestSection {
  summary: string
}

interface SpeakerApiResponse {
  id: number
  route_pathname: string
  name: string
  photoURL: string
  appearances_count: number
  sections_count: number
  sections: ApiSection[]
  longest_section: ApiLongestSection | null
  page?: number
  page_size?: number
  total_pages?: number
}

interface Speaker {
  id: number
  route_pathname: string
  name: string
  photoURL: string
  appearances_count: number
  sections_count: number
  sections: Section[]
  longest_section: LongestSection | null
  page?: number
  page_size?: number
  total_pages?: number
}


export default /*@__PURE__*/_defineComponent({
  __name: 'SingleSpeakerView',
  __ssrInlineRender: true,
  props: {
    initialSpeaker: { type: [Object, null], required: false, default: null },
    routePathname: { type: String, required: false, default: '' }
  },
  setup(__props: any) {

const props = __props

const speaker = ref<Speaker | null>(null)
const pageSize = computed(() => speaker.value?.page_size || 50)
const page = computed(() => speaker.value?.page || 1)
const totalPages = computed(() => speaker.value?.total_pages || 1)
const totalSections = computed(() => speaker.value?.sections_count || 0)

const resolvedRoutePathname = computed(() => {
  if (props.routePathname) return props.routePathname
  if (typeof window !== 'undefined') {
    const segments = window.location.pathname.split('/')
    const speakerIndex = segments.indexOf('speaker')
    const slug = speakerIndex >= 0 ? segments[speakerIndex + 1] : ''
    if (slug) {
      try {
        return encodeURIComponent(decodeURIComponent(slug))
      } catch {
        return slug
      }
    }
  }
  return ''
})

const stripHtmlTags = (html: string) => {
  if (!html) {
    return ''
  }
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

const normalizeSpeaker = (raw: SpeakerApiResponse | Speaker | null): Speaker | null => {
  if (!raw) return null

  const normalizedSections: Section[] = (raw.sections ?? []).map((section) => ({
    ...section,
    summary: 'summary' in section ? (section as Section).summary : stripHtmlTags(section.section_content),
  }))

  const normalizedLongestSection: LongestSection | null = raw.longest_section
    ? {
        ...raw.longest_section,
        summary:
          'summary' in raw.longest_section
            ? (raw.longest_section as LongestSection).summary
            : stripHtmlTags(raw.longest_section.section_content),
      }
    : null

  // 直接展開所有屬性，包括 page, page_size, total_pages
  return {
    ...raw,
    sections: normalizedSections,
    longest_section: normalizedLongestSection,
  } as Speaker
}

speaker.value = normalizeSpeaker(props.initialSpeaker)

const hasSections = computed(() => (speaker.value?.sections?.length ?? 0) > 0)
const displayName = computed(() => speaker.value?.name || 'This speaker')
const portraitUrl = computed(
  () => speaker.value?.photoURL || '/static/speeches/i/a.png'
)

const speakerColor = computed(() =>
  getSpeakerColor(
    speaker.value?.route_pathname ||
      props.routePathname ||
      resolvedRoutePathname.value ||
      speaker.value?.name ||
      ''
  )
)

// 生成演講連結（包含 hash，用於 router-link）
const getSpeechUrl = (filename: string, sectionId: number) => {
  return `/${encodeURIComponent(filename)}#s${sectionId}`
}

// 生成演講頁面連結
const getSpeechPageUrl = (sectionId: number) => {
  return `/speech/${sectionId}`
}

// 生成演講名稱連結（不含 hash）
const getSpeechNameUrl = (filename: string) => {
  return `/${encodeURIComponent(filename)}`
}

const resolvedRouteForLinks = computed(() => {
  const slug = props.routePathname || resolvedRoutePathname.value
  return slug || ''
})

const getPageUrl = (targetPage: number) => {
  const safePage = Math.max(1, Math.min(totalPages.value, targetPage))
  return `/speaker/${resolvedRouteForLinks.value}?page=${safePage}`
}

const hasPrev = computed(() => page.value > 1)
const hasNext = computed(() => page.value < totalPages.value)

// 生成分頁頁碼陣列
const paginationPages = computed(() => {
  if (props.initialSpeaker && Array.isArray((props.initialSpeaker as any).pagination_pages)) {
    return (props.initialSpeaker as any).pagination_pages as Array<number | 'ellipsis'>
  }

  const current = page.value
  const total = totalPages.value
  const pages: Array<number | 'ellipsis'> = []
  const addedPages = new Set<number>()

  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    addedPages.add(1)

    const nearStart = Math.max(2, current - 1)
    const nearEnd = Math.min(total - 2, current + 1)

    if (nearStart > 2) pages.push('ellipsis')

    for (let i = nearStart; i <= nearEnd; i++) {
      if (!addedPages.has(i)) {
        pages.push(i)
        addedPages.add(i)
      }
    }

    const lastTwoStart = total - 1
    if (nearEnd < lastTwoStart - 1) pages.push('ellipsis')

    if (!addedPages.has(lastTwoStart)) {
      pages.push(lastTwoStart)
      addedPages.add(lastTwoStart)
    }
    if (!addedPages.has(total)) {
      pages.push(total)
      addedPages.add(total)
    }
  }

  return pages
})

// 格式化 longest_section 的摘要：截取前30個字符，加上前後引號和省略號
const formatLongestSectionSummary = (summary: string) => {
  if (!summary) {
    return ''
  }
  const truncated = summary.length > 30 ? summary.substring(0, 30) + '...' : summary
  return `"${truncated}"`
}


return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))} data-v-SingleSpeakerView-ssr>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  if (speaker.value) {
    _push(`<div class="full-page" data-v-SingleSpeakerView-ssr><div class="full-page__row" data-v-SingleSpeakerView-ssr><div class="full-page__unit" data-v-SingleSpeakerView-ssr><div class="page-header page-header--with-portrait" data-v-SingleSpeakerView-ssr><div class="page-header__row" data-v-SingleSpeakerView-ssr><div class="speaker-page__details" data-v-SingleSpeakerView-ssr><img${
      _ssrRenderAttr("src", portraitUrl.value)
    } style="${
      _ssrRenderStyle(`border-color: ${speakerColor.value}; background-color: ${speakerColor.value};`)
    }" class="speaker-portrait speaker-portrait--left speaker-portrait--large round-image"${
      _ssrRenderAttr("alt", `Headshot of ${displayName.value}`)
    } data-v-SingleSpeakerView-ssr><div class="speaker-information" data-v-SingleSpeakerView-ssr><h1 data-v-SingleSpeakerView-ssr>${
      _ssrInterpolate(displayName.value)
    }</h1></div><div class="speaker-page__stats" data-v-SingleSpeakerView-ssr>`)
    if (hasSections.value) {
      _push(`<div class="stat" data-v-SingleSpeakerView-ssr><div class="stat__figure" data-v-SingleSpeakerView-ssr>${_ssrInterpolate(speaker.value.appearances_count)}</div><div class="stat__descriptor" data-v-SingleSpeakerView-ssr><span lang="zh" data-v-SingleSpeakerView-ssr>出現次數</span><span lang="en" data-v-SingleSpeakerView-ssr>Appearances</span></div></div>`)
    } else {
      _push(`<!---->`)
    }
    _push(`<div class="stat" data-v-SingleSpeakerView-ssr><div class="stat__figure" data-v-SingleSpeakerView-ssr>${_ssrInterpolate(hasSections.value ? speaker.value.sections_count : 0)}</div><div class="stat__descriptor" data-v-SingleSpeakerView-ssr><span lang="zh" data-v-SingleSpeakerView-ssr>發言數</span><span lang="en" data-v-SingleSpeakerView-ssr>Speeches</span></div></div><!--
									<div class="stat">
										<div class="stat__figure">
											4<sup>th</sup>
										</div>
										<div class="stat__descriptor">
											of 60 speakers
										</div>
									</div>
									-->`)
    if (speaker.value.longest_section) {
      _push(`<div class="stat" data-v-SingleSpeakerView-ssr><div class="stat__figure" data-v-SingleSpeakerView-ssr><a${
        _ssrRenderAttr("href", getSpeechUrl(speaker.value.longest_section.section_filename, speaker.value.longest_section.section_id))
      } data-v-SingleSpeakerView-ssr>${
        _ssrInterpolate(formatLongestSectionSummary(speaker.value.longest_section.summary))
      }</a></div><div class="stat__descriptor" data-v-SingleSpeakerView-ssr><span lang="zh" data-v-SingleSpeakerView-ssr>最長發言</span><span lang="en" data-v-SingleSpeakerView-ssr>Longest speech</span></div></div>`)
    } else {
      _push(`<!---->`)
    }
    _push(`</div></div></div></div><div class="speaker-page__speeches-collection" data-v-SingleSpeakerView-ssr><div class="full-page__row nested-row" data-v-SingleSpeakerView-ssr><div class="speaker-page__speeches-title" data-v-SingleSpeakerView-ssr><h2 data-v-SingleSpeakerView-ssr><span lang="zh" data-v-SingleSpeakerView-ssr>發言</span><span lang="en" data-v-SingleSpeakerView-ssr>Speeches</span></h2></div><div class="speaker-page__add-speech" data-v-SingleSpeakerView-ssr></div><div class="speaker-page__search" data-v-SingleSpeakerView-ssr><form class="site-search site-search" action="/search/" method="get" data-v-SingleSpeakerView-ssr><input type="hidden" name="p"${_ssrRenderAttr("value", speaker.value.id)} data-v-SingleSpeakerView-ssr><div class="search-wrapper" data-v-SingleSpeakerView-ssr><input type="search" class="site-search__input" placeholder="Search this person&#39;s speeches" name="q" data-v-SingleSpeakerView-ssr><input type="submit" class="icon-search icon-search" value="Search" data-v-SingleSpeakerView-ssr></div></form></div></div><ul class="unstyled js-masonry" data-masonry-options="{&quot;columnWidth&quot;:&quot;.speech&quot;,&quot;itemSelector&quot;:&quot;.speech&quot;,&quot;gutter&quot;:&quot;.gutter-sizer&quot;}" data-v-SingleSpeakerView-ssr><li class="gutter-sizer" data-v-SingleSpeakerView-ssr></li>`)
    if (!hasSections.value) {
      _push(`<li class="speech" data-v-SingleSpeakerView-ssr><span lang="zh" data-v-SingleSpeakerView-ssr>${
        _ssrInterpolate(displayName.value)
      } 尚無紀錄的發言。</span><span lang="en" data-v-SingleSpeakerView-ssr>${
        _ssrInterpolate(displayName.value)
      } has no recorded speeches yet.</span></li>`)
    } else {
      _push(`<!---->`)
    }
    _push(`<!--[-->`)
    _ssrRenderList(speaker.value.sections, (section) => {
      _push(`<li${
        _ssrRenderAttr("id", `s${section.section_id}`)
      } class="speech speech--speech speech--border" style="${
        _ssrRenderStyle({ borderLeftColor: speakerColor.value })
      }" data-v-SingleSpeakerView-ssr><div class="speech-wrapper" data-v-SingleSpeakerView-ssr><div class="speech__breadcrumb" data-v-SingleSpeakerView-ssr><ul class="breadcrumbs" data-v-SingleSpeakerView-ssr><li data-v-SingleSpeakerView-ssr><a${
        _ssrRenderAttr("href", getSpeechNameUrl(section.filename))
      } data-v-SingleSpeakerView-ssr>${
        _ssrInterpolate(section.display_name)
      }</a></li><li class="no-content-after" data-v-SingleSpeakerView-ssr><span class="breadcrumbs__date" data-v-SingleSpeakerView-ssr></span></li></ul></div><div class="speech__meta-data" data-v-SingleSpeakerView-ssr></div><a${
        _ssrRenderAttr("title", `Link in context`)
      }${
        _ssrRenderAttr("href", getSpeechUrl(section.filename, section.section_id))
      } class="speech__content-link" data-v-SingleSpeakerView-ssr><div class="speech__content" data-v-SingleSpeakerView-ssr><p data-v-SingleSpeakerView-ssr>${
        _ssrInterpolate(section.summary)
      }</p></div></a><div class="speech__links" data-v-SingleSpeakerView-ssr><a${
        _ssrRenderAttr("title", `Link in context`)
      }${
        _ssrRenderAttr("href", getSpeechUrl(section.filename, section.section_id))
      } data-v-SingleSpeakerView-ssr><i class="speech-icon icon-link-in-context" data-v-SingleSpeakerView-ssr></i><span lang="zh" data-v-SingleSpeakerView-ssr>前後文</span><span lang="en" data-v-SingleSpeakerView-ssr>Link in context</span></a><a${
        _ssrRenderAttr("title", `Link`)
      }${
        _ssrRenderAttr("href", getSpeechPageUrl(section.section_id))
      } data-v-SingleSpeakerView-ssr><i class="speech-icon icon-link" data-v-SingleSpeakerView-ssr></i><span lang="zh" data-v-SingleSpeakerView-ssr>連結</span><span lang="en" data-v-SingleSpeakerView-ssr>Link</span></a></div></div></li>`)
    })
    _push(`<!--]--></ul><div class="pagination" data-v-SingleSpeakerView-ssr><span class="${
      _ssrRenderClass(['button search-pagination-button', hasPrev.value ? '' : 'button--disabled'])
    }"${
      _ssrRenderAttr("aria-disabled", !hasPrev.value)
    } data-v-SingleSpeakerView-ssr>`)
    if (hasPrev.value) {
      _push(`<a${_ssrRenderAttr("href", getPageUrl(page.value - 1))} data-v-SingleSpeakerView-ssr>← Previous</a>`)
    } else {
      _push(`<!--[-->← Previous<!--]-->`)
    }
    _push(`</span><!--[-->`)
    _ssrRenderList(paginationPages.value, (pageNum) => {
      _push(`<!--[-->`)
      if (pageNum === 'ellipsis') {
        _push(`<span class="pagination__no__border" data-v-SingleSpeakerView-ssr>...</span>`)
      } else if (pageNum !== page.value) {
        _push(`<a${
          _ssrRenderAttr("href", getPageUrl(pageNum as number))
        } class="button pagination__page-number" data-v-SingleSpeakerView-ssr>${
          _ssrInterpolate(pageNum)
        }</a>`)
      } else {
        _push(`<span class="pagination__page-number current" data-v-SingleSpeakerView-ssr>${_ssrInterpolate(pageNum)}</span>`)
      }
      _push(`<!--]-->`)
    })
    _push(`<!--]--><span class="${
      _ssrRenderClass(['button search-pagination-button', hasNext.value ? '' : 'button--disabled'])
    }"${
      _ssrRenderAttr("aria-disabled", !hasNext.value)
    } data-v-SingleSpeakerView-ssr>`)
    if (hasNext.value) {
      _push(`<a${_ssrRenderAttr("href", getPageUrl(page.value + 1))} data-v-SingleSpeakerView-ssr>Next →</a>`)
    } else {
      _push(`<!--[-->Next →<!--]-->`)
    }
    _push(`</span></div></div></div></div></div>`)
  } else {
    _push(`<!---->`)
  }
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "\n.button.pagination__page-number[data-v-SingleSpeakerView-ssr] {\n\t\tmargin: auto .2rem;\n}\n";
