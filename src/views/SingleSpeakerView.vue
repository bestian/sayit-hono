<script setup lang="ts">
import { computed,  ref } from 'vue'

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

  return {
    ...(raw as Speaker),
    sections: normalizedSections,
    longest_section: normalizedLongestSection,
  }
}

speaker.value = normalizeSpeaker(props.initialSpeaker)

const hasSections = computed(() => (speaker.value?.sections?.length ?? 0) > 0)
const displayName = computed(() => speaker.value?.name || 'This speaker')
const portraitUrl = computed(
  () => speaker.value?.photoURL ? 'https://sayit.archive.tw' + speaker.value?.photoURL : '/static/speeches/i/a.png'
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

// 格式化 longest_section 的摘要：截取前30個字符，加上前後引號和省略號
const formatLongestSectionSummary = (summary: string) => {
  if (!summary) {
    return ''
  }
  const truncated = summary.length > 30 ? summary.substring(0, 30) + '...' : summary
  return `“${truncated}”`
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
								<img :src="portraitUrl" style="border-color: #319393; background-color: #319393;"
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
											Appearances
										</div>
									</div>
									<div class="stat">
										<div class="stat__figure">
											{{ hasSections ? speaker.sections_count : 0 }}
										</div>
										<div class="stat__descriptor">
											Speeches
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
											Longest speech
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
					<div class="speaker-page__speeches-collection">
						<div class="full-page__row nested-row">
							<div class="speaker-page__speeches-title">
								<h2>Speeches</h2>
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
								{{ displayName }} has no recorded speeches yet.
							</li>
							<li v-for="section in speaker.sections" :key="section.section_id" :id="`s${section.section_id}`"
								class="speech speech--speech speech--border" style="border-left-color: rgb(77, 137, 210);">
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
											<i class="speech-icon icon-link-in-context"></i>Link in context
										</a>
										<a :title="`Link`" :href="getSpeechPageUrl(section.section_id)">
											<i class="speech-icon icon-link"></i>Link
										</a>
									</div>
								</div>
							</li>
						</ul>
						<div class="pagination">
							<span class="button--disabled button search-pagination-button">← Previous</span>
							<span class="button current pagination__page-number">1</span>
							<a href="?page=2" class="button pagination__page-number">2</a>
							<a href="?page=3" class="button pagination__page-number">3</a>
							...
							<a href="?page=1911" class="button pagination__page-number">1911</a>
							<a href="?page=1912" class="button pagination__page-number">1912</a>
							<a href="?page=2" class="button search-pagination-button">Next →</a>
						</div>
					</div>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>
