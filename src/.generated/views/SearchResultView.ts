// 由 scripts/build-views.ts 自動產生，請勿手動編輯
import { defineComponent as _defineComponent } from 'vue'
import { resolveComponent as _resolveComponent, mergeProps as _mergeProps } from "vue"
import { ssrRenderComponent as _ssrRenderComponent, ssrRenderAttr as _ssrRenderAttr, ssrRenderStyle as _ssrRenderStyle, ssrRenderClass as _ssrRenderClass, ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate, ssrRenderList as _ssrRenderList } from "vue/server-renderer"

import { computed } from 'vue';
import { getSpeakerColor } from '../../utils/speakerColor';

type SpeakerResult = {
	route_pathname: string;
	name: string;
	photoURL: string | null;
	snippet: string;
};

type SectionResult = {
	section_id: number;
	filename: string;
	nest_filename: string | null;
	section_speaker: string | null;
	speaker_name: string | null;
	display_name: string;
	photoURL: string | null;
	snippet: string;
};

type PaginationPage = number | 'ellipsis';


export default /*@__PURE__*/_defineComponent({
  __name: 'SearchResultView',
  __ssrInlineRender: true,
  props: {
    query: { type: String, required: true },
    speakers: { type: Array, required: true },
    sections: { type: Array, required: true },
    page: { type: Number, required: false },
    page_size: { type: Number, required: false },
    total_pages: { type: Number, required: false },
    total_sections: { type: Number, required: false },
    pagination_pages: { type: Array, required: false },
    filteredSpeakerId: { type: Number, required: false },
    filteredSpeakerName: { type: [String, null], required: false }
  },
  setup(__props: any) {

const props = __props;

const encodedQuery = computed(() => encodeURIComponent(props.query ?? ''));
const pageSize = computed(() => {
	const num = Number(props.page_size);
	if (Number.isFinite(num) && num > 0) return Math.floor(num);
	return 20;
});
const safePage = computed(() => {
	const num = Number(props.page);
	return Number.isFinite(num) && num > 0 ? Math.floor(num) : 1;
});
const totalSections = computed(() => {
	const num = Number(props.total_sections);
	if (Number.isFinite(num) && num >= 0) return Math.floor(num);
	return props.sections?.length ?? 0;
});
const totalPages = computed(() => {
	const num = Number(props.total_pages);
	if (Number.isFinite(num) && num > 0) return Math.floor(num);
	const sectionsCount = totalSections.value;
	return sectionsCount > 0 ? Math.ceil(sectionsCount / pageSize.value) : 1;
});
const resolvedPaginationPages = computed<PaginationPage[]>(() => {
	if (Array.isArray(props.pagination_pages) && props.pagination_pages.length > 0) {
		return props.pagination_pages;
	}
	return [safePage.value];
});
const hasPrev = computed(() => safePage.value > 1);
const hasNext = computed(() => safePage.value < totalPages.value);

// 供 SSR 使用：有講者篩選時帶入分頁與連結
const speakerIdForFilter = computed(() => (props.filteredSpeakerId ? props.filteredSpeakerId.toString() : null));

function colorKey(section: SectionResult) {
	return section.section_speaker || section.filename || section.speaker_name || '';
}

function sectionBorderStyle(section: SectionResult) {
	const color = getSpeakerColor(colorKey(section));
	return { borderColor: color };
}

function avatarStyle(section: SectionResult) {
	const color = getSpeakerColor(colorKey(section));
	return { borderColor: color, backgroundColor: color };
}

function sectionLink(section: SectionResult) {
	const encodedFilename = encodeURIComponent(section.filename);
	const encodedNest = section.nest_filename ? `/${encodeURIComponent(section.nest_filename)}` : '';
	return `/${encodedFilename}${encodedNest}#s${section.section_id}`;
}

function pageHref(page: number) {
	const safe = Number.isFinite(page) ? Math.max(1, Math.min(totalPages.value, Math.floor(page))) : 1;

	// 從 props 或當前 URL 取得 p 參數（講者 ID）
	let speakerIdParam = '';
	const speakerId = speakerIdForFilter.value;
	if (speakerId) {
		speakerIdParam = `&p=${encodeURIComponent(speakerId)}`;
	}

	return `/search/?page=${safe}&q=${encodedQuery.value}${speakerIdParam}`;
}

return (_ctx: any,_push: any,_parent: any,_attrs: any) => {
  const _component_Navbar = _resolveComponent("Navbar")!
  const _component_Footer = _resolveComponent("Footer")!

  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "page" }, _attrs))}>`)
  _push(_ssrRenderComponent(_component_Navbar, null, null, _parent))
  _push(`<div class="full-page"><div class="full-page__row"><div class="full-page__unit"><h1 class="search-title-with-result"><span lang="zh">搜尋</span><span lang="en">Search</span> / <strong>${
    _ssrInterpolate(__props.query)
  }</strong></h1><form class="site-search site-search--on-results-page" action="/search/" method="get"><div class="search-wrapper"><input type="search" class="site-search__input" placeholder="Search" name="q"${
    _ssrRenderAttr("value", __props.query)
  }><input type="submit" class="icon-search" value="Search"></div></form><div class="page-content__row"><div class="full-page__unit"><!-- 當有講者篩選時，顯示 checkbox -->`)
  if (__props.filteredSpeakerId && __props.filteredSpeakerName) {
    _push(`<label><input type="checkbox" name="p"${
      _ssrRenderAttr("value", __props.filteredSpeakerId)
    } checked><span lang="zh">僅搜尋 ${
      _ssrInterpolate(__props.filteredSpeakerName)
    } 的發言</span><span lang="en">Search only speeches by ${
      _ssrInterpolate(__props.filteredSpeakerName)
    }</span></label>`)
  } else {
    _push(`<!--[--><!-- 沒有講者篩選時，顯示原本的 Speakers 區塊 --><h2><span lang="zh">講者</span><span lang="en">Speakers</span></h2><ul class="unstyled-list search-results-speakers"><!--[-->`)
    _ssrRenderList(__props.speakers, (speaker) => {
      _push(`<li class="search"><a${
        _ssrRenderAttr("href", `/speaker/${speaker.route_pathname}`)
      }><span>${
        (speaker.snippet || speaker.name) ?? ''
      }</span></a></li>`)
    })
    _push(`<!--]-->`)
    if (__props.speakers.length === 0) {
      _push(`<li class="search"><span lang="zh">沒有符合的講者。</span><span lang="en">There are no speakers that match your search.</span></li>`)
    } else {
      _push(`<!---->`)
    }
    _push(`</ul><!--]-->`)
  }
  _push(`<h2><span lang="zh">在對話中提及 <strong>“${
    _ssrInterpolate(__props.query)
  }”</strong></span><span lang="en">Mentions of <strong>“${
    _ssrInterpolate(__props.query)
  }”</strong> in speeches</span></h2><ul class="unstyled-list search-results-list"><!--[-->`)
  _ssrRenderList(__props.sections, (section) => {
    _push(`<li class="speech speech--search-result speech--with-portrait speech--speech speech--border" style="${
      _ssrRenderStyle(sectionBorderStyle(section))
    }"><div class="speaker-portrait-wrapper"><img${
      _ssrRenderAttr("src", section.photoURL || '/static/speeches/i/a.png')
    }${
      _ssrRenderAttr("alt", section.speaker_name || '')
    } style="${
      _ssrRenderStyle(avatarStyle(section))
    }" class="speaker-portrait speaker-portrait--left round-image speaker-portrait--medium"></div><div class="speech-wrapper"><div class="speech__breadcrumb"><ul class="breadcrumbs"><li><a${
      _ssrRenderAttr("href", sectionLink(section))
    }>${
      _ssrInterpolate(section.display_name)
    }</a></li></ul></div><div class="speech__meta-data">`)
    if (section.speaker_name) {
      _push(`<span class="speech__meta-data__speaker-name"><a${
        _ssrRenderAttr("href", section.section_speaker ? `/speaker/${section.section_speaker}` : undefined)
      }>${
        _ssrInterpolate(section.speaker_name)
      }</a></span>`)
    } else {
      _push(`<!---->`)
    }
    _push(`</div><div class="speech__content"><p class="search"><a title="Link in context"${
      _ssrRenderAttr("href", sectionLink(section))
    }>${
      (section.snippet) ?? ''
    }</a></p></div></div></li>`)
  })
  _push(`<!--]-->`)
  if (__props.sections.length === 0) {
    _push(`<li class="speech speech--search-result speech--with-portrait speech--speech speech--border"><div class="speech-wrapper"><div class="speech__content"><span lang="zh">沒有找到相關段落</span><span lang="en">No matching sections found.</span></div></div></li>`)
  } else {
    _push(`<!---->`)
  }
  _push(`</ul><div class="pagination"><span class="${
    _ssrRenderClass(['button search-pagination-button', hasPrev.value ? '' : 'button--disabled'])
  }"${
    _ssrRenderAttr("aria-disabled", !hasPrev.value)
  }>`)
  if (hasPrev.value) {
    _push(`<a${_ssrRenderAttr("href", pageHref(safePage.value - 1))}>← <span lang="zh">上一頁</span><span lang="en">Previous</span></a>`)
  } else {
    _push(`<!--[-->← <span lang="zh">上一頁</span><span lang="en">Previous</span><!--]-->`)
  }
  _push(`</span><!--[-->`)
  _ssrRenderList(resolvedPaginationPages.value, (pageNum) => {
    _push(`<!--[-->`)
    if (pageNum === 'ellipsis') {
      _push(`<span class="pagination__no__border">...</span>`)
    } else if (pageNum !== safePage.value) {
      _push(`<a${
        _ssrRenderAttr("href", pageHref(pageNum as number))
      } class="button pagination__page-number">${
        _ssrInterpolate(pageNum)
      }</a>`)
    } else {
      _push(`<span class="button current pagination__page-number">${_ssrInterpolate(pageNum)}</span>`)
    }
    _push(`<!--]-->`)
  })
  _push(`<!--]--><span class="${
    _ssrRenderClass(['button search-pagination-button', hasNext.value ? '' : 'button--disabled'])
  }"${
    _ssrRenderAttr("aria-disabled", !hasNext.value)
  }>`)
  if (hasNext.value) {
    _push(`<a${_ssrRenderAttr("href", pageHref(safePage.value + 1))}><span lang="zh">下一頁</span><span lang="en">Next</span> →</a>`)
  } else {
    _push(`<!--[--><span lang="zh">下一頁</span><span lang="en">Next</span> →<!--]-->`)
  }
  _push(`</span></div></div></div></div></div></div>`)
  _push(_ssrRenderComponent(_component_Footer, null, null, _parent))
  _push(`</div>`)
}
}

})

export const styles = "";
