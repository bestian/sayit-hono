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

interface SpeakerBlock {
  id: number
  speaker: string | null
  name: string | null
  photoURL: string | null
  color: string
  sections: Section[]
}

const props = defineProps<{
  sections: Section[]
  speechName: string
  displayName?: string
  alternateUrl?: string | null
  alternateLabel?: string | null
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

const recordLanguage = computed(() => {
	const sample = displaySections.value
		.slice(0, 8)
		.map((section) => section.section_content)
		.join(' ');
	return /[\u3400-\u9fff]/u.test(sample) ? 'zh-Hant' : 'en';
})

const getLinkInContextUrl = (section: Section) =>
  `/${encodeURIComponent(section.filename)}#s${section.section_id}`


const getSpeakerUrl = (sectionSpeaker: string) => `/speaker/${sectionSpeaker}`

// 把連續同一講者的 section 合併成一個 block：
// 同一講者連續多段時 chrome 不再重複，sticky 範圍 = 整個 block，
// 換講者時前一個 chrome 自然滑出。
const speakerBlocks = computed<SpeakerBlock[]>(() => {
	const blocks: SpeakerBlock[] = []
	let current: SpeakerBlock | null = null
	for (const section of displaySections.value) {
		const speaker = section.section_speaker ?? null
		if (current && current.speaker === speaker) {
			current.sections.push(section)
			continue
		}
		current = {
			id: section.section_id,
			speaker,
			name: section.name,
			photoURL: section.photoURL,
			color: getSpeakerColor(speaker ?? section.name ?? ''),
			sections: [section],
		}
		blocks.push(current)
	}
	return blocks
})

const blockStyle = (block: SpeakerBlock): Record<string, string> => ({
	'--speaker-color': block.speaker ? block.color : 'var(--rule)',
})

const blockAvatarStyle = (block: SpeakerBlock) => ({
	borderColor: block.color,
	backgroundColor: block.color,
})

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
		<Navbar>
			<a
				v-if="alternateUrl && alternateLabel"
				:href="alternateUrl"
				class="sayit-lang-switch"
				:aria-label="alternateLabel === 'English' ? 'Open English record' : '開啟華文紀錄'"
			>
				<span lang="zh">開啟 {{ alternateLabel }}</span><span lang="en">Open {{ alternateLabel }}</span>
			</a>
		</Navbar>
		<main id="main-content">
			<div class="sayit-ask-overlay">
				<div id="sayit-ask-answer" class="homepage-ask-answer" aria-live="polite" hidden></div>
			</div>
			<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden></div>
			<div class="full-page">
				<div class="full-page__row">
					<div class="full-page__unit">
						<header class="page-header page-header--speech">
							<h1 v-if="!loading && displaySections.length > 0 && displaySections[0]">
								{{ displaySections[0].display_name }}
							</h1>
							<h1 v-else>{{ formattedSpeechName }}</h1>
						</header>
						<div class="page-content__row" v-if="!loading">
							<div class="primary-content__unit">
								<ol class="section-list" aria-label="Transcript turns">
									<li
										v-for="block in speakerBlocks"
										:key="`block-${block.id}`"
										class="speech speech--border speaker-block"
										:style="blockStyle(block)"
									>
										<div v-if="block.speaker" class="turnline__speaker">
											<img
												:src="block.photoURL || '/static/speeches/i/a.png'"
												:style="blockAvatarStyle(block)"
												:alt="block.name || ''"
												class="speaker-portrait speaker-portrait--medium"
											>
											<span :id="`speaker-${block.id}`" class="turnline__speaker-name">
												<a :href="getSpeakerUrl(block.speaker)">{{ block.name || block.speaker }}</a>
											</span>
										</div>
										<article
											v-for="section in block.sections"
											:key="section.section_id"
											:id="`s${section.section_id}`"
											class="speech-wrapper speaker-block__section"
											:aria-labelledby="block.speaker ? `speaker-${block.id}` : undefined"
										>
											<a
												class="turnline__anchor"
												:href="getLinkInContextUrl(section)"
												data-sayit-share
												:data-share-url="getLinkInContextUrl(section)"
												:data-share-title="section.display_name"
												:title="recordLanguage === 'zh-Hant' ? '分享此段' : 'Share turn'"
												:aria-label="recordLanguage === 'zh-Hant' ? `分享發言段落 ${section.section_id}` : `Share turn ${section.section_id}`"
											></a>
											<div
												class="speech__content record-copy"
												:lang="recordLanguage"
												v-html="sanitizeHtmlContent(section.section_content)"
											></div>
										</article>
									</li>
								</ol>
							</div>
							<div class="sidebar__unit section-detail-sidebar"></div>
						</div>
					</div>
				</div>
			</div>
		</main>
		<Footer />
	</div>
</template>
