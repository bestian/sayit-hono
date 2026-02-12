<script setup lang="ts">
import { computed,  ref } from 'vue'
import { getSpeakerColor } from '../utils/speakerColor'

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

const props = withDefaults(
  defineProps<{
    initialSpeaker?: Speaker | null
    routePathname?: string
  }>(),
  {
    initialSpeaker: null,
    routePathname: '',
  }
)

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

</script>

<template>

	<div class="page">
		<Navbar />
		<div class="full-page" v-if="speaker">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="page-header page-header--with-portrait">
						<div class="page-header__row">
							<div class="speaker-page__details">
								<img :src="portraitUrl" :style="`border-color: ${speakerColor}; background-color: ${speakerColor};`"
									class="speaker-portrait speaker-portrait--left speaker-portrait--large round-image"
									:alt="`Headshot of ${displayName}`">
								<div class="speaker-information">
									<h1>{{ displayName }}</h1>
								</div>
								<div class="speaker-page__stats">
									<div class="stat" v-if="hasSections">
										<div class="stat__figure">
											{{ speaker.appearances_count }}
										</div>
										<div class="stat__descriptor">
											<span lang="zh">出現次數</span><span lang="en">Appearances</span>
										</div>
									</div>
									<div class="stat">
										<div class="stat__figure">
											{{ hasSections ? speaker.sections_count : 0 }}
										</div>
										<div class="stat__descriptor">
											<span lang="zh">發言數</span><span lang="en">Speeches</span>
										</div>
									</div>
									<!--
									<div class="stat">
										<div class="stat__figure">
											4<sup>th</sup>
										</div>
										<div class="stat__descriptor">
											of 60 speakers
										</div>
									</div>
									-->
									<div class="stat" v-if="speaker.longest_section">
										<div class="stat__figure">
											<a
												:href="getSpeechUrl(speaker.longest_section.section_filename, speaker.longest_section.section_id)">
												{{ formatLongestSectionSummary(speaker.longest_section.summary) }}
											</a>
										</div>
										<div class="stat__descriptor">
											<span lang="zh">最長發言</span><span lang="en">Longest speech</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
					<div class="speaker-page__speeches-collection">
						<div class="full-page__row nested-row">
							<div class="speaker-page__speeches-title">
								<h2><span lang="zh">發言</span><span lang="en">Speeches</span></h2>
							</div>
							<div class="speaker-page__add-speech">
							</div>
							<div class="speaker-page__search">
								<form class="site-search site-search" action="/search/" method="get">
									<input type="hidden" name="p" :value="speaker.id">
									<div class="search-wrapper">
										<input type="search" class="site-search__input" placeholder="Search this person's speeches" name="q">
										<input type="submit" class="icon-search icon-search" value="Search">
									</div>
								</form>
							</div>
						</div>
						<ul class="unstyled js-masonry"
							data-masonry-options='{"columnWidth":".speech","itemSelector":".speech","gutter":".gutter-sizer"}'>
							<li class="gutter-sizer"></li>
							<li v-if="!hasSections" class="speech">
								<span lang="zh">{{ displayName }} 尚無紀錄的發言。</span><span lang="en">{{ displayName }} has no recorded speeches yet.</span>
							</li>
							<li v-for="section in speaker.sections" :key="section.section_id" :id="`s${section.section_id}`"
								class="speech speech--speech speech--border" :style="{ borderLeftColor: speakerColor }">
								<div class="speech-wrapper">
									<div class="speech__breadcrumb">
										<ul class="breadcrumbs">
											<li>
												<a :href="getSpeechNameUrl(section.filename)">
													{{ section.display_name }}
												</a>
											</li>
											<li class="no-content-after">
												<span class="breadcrumbs__date">
												</span>
											</li>
										</ul>
									</div>
									<div class="speech__meta-data">
									</div>
									<a :title="`Link in context`" :href="getSpeechUrl(section.filename, section.section_id)"
										class="speech__content-link">
										<div class="speech__content">
											<p>{{ section.summary }}</p>
										</div>
									</a>
									<div class="speech__links">
										<a :title="`Link in context`" :href="getSpeechUrl(section.filename, section.section_id)">
											<i class="speech-icon icon-link-in-context"></i><span lang="zh">前後文</span><span lang="en">Link in context</span>
										</a>
										<a :title="`Link`" :href="getSpeechPageUrl(section.section_id)">
											<i class="speech-icon icon-link"></i><span lang="zh">連結</span><span lang="en">Link</span>
										</a>
									</div>
								</div>
							</li>
						</ul>
						<div class="pagination">
							<span
								:class="['button search-pagination-button', hasPrev ? '' : 'button--disabled']"
								:aria-disabled="!hasPrev"
							>
								<template v-if="hasPrev">
									<a :href="getPageUrl(page - 1)">← Previous</a>
								</template>
								<template v-else>← Previous</template>
							</span>
							<template v-for="pageNum in paginationPages" :key="pageNum === 'ellipsis' ? 'ellipsis' : pageNum">
								<span
									v-if="pageNum === 'ellipsis'"
									class="pagination__no__border"
								>...</span>
								<a
									v-else-if="pageNum !== page"
									:href="getPageUrl(pageNum as number)"
									class="button pagination__page-number"
								>{{ pageNum }}</a>
								<span
									v-else
									class="pagination__page-number current"
								>{{ pageNum }}</span>
							</template>
							<span
								:class="['button search-pagination-button', hasNext ? '' : 'button--disabled']"
								:aria-disabled="!hasNext"
							>
								<template v-if="hasNext">
									<a :href="getPageUrl(page + 1)">Next →</a>
								</template>
								<template v-else>Next →</template>
							</span>
						</div>
					</div>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>

<style scoped>
	.button.pagination__page-number {
		margin: auto .2rem;
	}
</style>
