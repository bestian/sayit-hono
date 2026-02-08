<script setup lang="ts">
import { computed } from 'vue'
import { getSpeakerColor } from '../utils/speakerColor'

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

const props = defineProps<{
  sections: Section[]
  speechName: string
  displayName?: string
}>()

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

const loading = false
</script>

<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="page-header page-header--speech">
						<ul class="breadcrumbs">
						</ul>
						<h1 v-if="!loading && displaySections.length > 0 && displaySections[0]">{{ displaySections[0].display_name }}
						</h1>
						<h1 v-else>{{ formattedSpeechName }}</h1>
					</div>
					<div class="page-content__row" v-if="!loading">
						<div class="primary-content__unit">
							<ul class="section-list">
								<li v-for="section in displaySections" :key="section.section_id" :id="`s${section.section_id}`" :class="[
									'speech',
									'speech--',
									'speech--border',
									section.section_speaker ? 'speech--with-portrait' : ''
								]" :style="borderStyle(section)">
									<div class="speaker-portrait-wrapper" v-if="section.section_speaker">
										<img :src="section.photoURL || '/static/speeches/i/a.png'"
											:style="avatarStyle(section)"
											:alt="section.name || ''"
											class="speaker-portrait speaker-portrait--left round-image speaker-portrait--medium">
									</div>
									<div class="speech-wrapper">
										<div class="speech__meta-data" v-if="section.section_speaker && section.name">
											<span class="speech__meta-data__speaker-name">
												<a :href="getSpeakerUrl(section.section_speaker)">
													{{ section.name }}
												</a>
											</span>
										</div>
										<div class="speech__content" v-html="sanitizeHtmlContent(section.section_content)">
										</div>
										<div class="speech__links">
											<a :href="getLinkInContextUrl(section)" title="Link in context">
												<i class="speech-icon icon-link-in-context"></i>Link in context
											</a>
											<a :href="getSpeechPageUrl(section.section_id)" title="Link">
												<i class="speech-icon icon-link"></i>Link
											</a>
										</div>
									</div>
								</li>
							</ul>
						</div>
						<!-- close primary-content__unit -->
						<div class="sidebar__unit section-detail-sidebar">
						</div>
						<!-- close sidebar__unit -->
					</div>
					<!-- close page-content_row -->
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>
