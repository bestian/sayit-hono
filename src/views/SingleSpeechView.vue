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

const getLinkInContextUrl = (section: Section) =>
  `/${encodeURIComponent(section.filename)}#s${section.section_id}`

const getSpeechPageUrl = (sectionId: number) => `/speech/${sectionId}`

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

const blockBorderStyle = (block: SpeakerBlock) =>
	block.speaker ? { borderLeftColor: block.color } : {}

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
			<div id="sayit-search" class="sayit-search" role="search">
				<div class="sayit-search__row">
					<div class="sayit-search__input-wrap">
						<input id="sayit-search-input" type="search" class="sayit-search__input" autocomplete="off" spellcheck="false" aria-label="Search speeches">
						<span class="sayit-search__shortcut" id="sayit-search-shortcut" aria-hidden="true">/</span>
					</div>
					<button type="button" class="sayit-search__submit" aria-label="Search">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
					</button>
				</div>
			</div>
		</Navbar>
		<div class="sayit-ask-overlay">
		<div id="sayit-ask-answer" class="homepage-ask-answer" aria-live="polite" hidden></div>
		<button type="button" id="sayit-ask-submit" class="homepage-ask__submit" hidden aria-hidden="true"></button>
		</div>
		<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden></div>
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="page-header page-header--speech">
						<h1 v-if="!loading && displaySections.length > 0 && displaySections[0]">{{ displaySections[0].display_name }}
						</h1>
						<h1 v-else>{{ formattedSpeechName }}</h1>
					</div>
					<div class="page-content__row" v-if="!loading">
						<div class="primary-content__unit">
							<ul class="section-list">
								<li
									v-for="block in speakerBlocks"
									:key="`block-${block.id}`"
									:class="[
										'speech',
										'speech--',
										'speech--border',
										block.speaker ? 'speech--with-portrait speaker-block' : ''
									]"
									:style="blockBorderStyle(block)"
								>
									<div class="speaker-portrait-wrapper" v-if="block.speaker">
										<img :src="block.photoURL || '/static/speeches/i/a.png'"
											:style="blockAvatarStyle(block)"
											:alt="block.name || ''"
											class="speaker-portrait speaker-portrait--left round-image speaker-portrait--medium">
									</div>
									<div class="speech__meta-data" v-if="block.speaker && block.name">
										<span class="speech__meta-data__speaker-name">
											<a :href="getSpeakerUrl(block.speaker)">{{ block.name }}</a>
										</span>
									</div>
									<div
										v-for="section in block.sections"
										:key="section.section_id"
										:id="`s${section.section_id}`"
										class="speech-wrapper speaker-block__section"
									>
										<div class="speech__content" v-html="sanitizeHtmlContent(section.section_content)"></div>
										<div class="speech__links">
											<a :href="getLinkInContextUrl(section)" title="Link in context">
												<i class="speech-icon icon-link-in-context"></i><span lang="zh">前後文</span><span lang="en">Link in context</span>
											</a>
											<a :href="getSpeechPageUrl(section.section_id)" title="Link">
												<i class="speech-icon icon-link"></i><span lang="zh">連結</span><span lang="en">Link</span>
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

<style scoped>
/* 同一講者連續多段時，所有 sections 共享一個 li.speaker-block：
   - 兩欄版面：左欄 avatar、右欄姓名與內容（mimic 原本的 .speech--with-portrait 視覺）
   - chrome（avatar、姓名）sticky 在整個 block 範圍內，講者切換時自然滑出。 */
.speaker-block {
	display: grid;
	grid-template-columns: 8.33% 1fr;
	gap: 0 0.5em;
}
.speaker-block .speaker-portrait-wrapper {
	grid-column: 1;
	grid-row: 1 / span 99;
	float: none;
	position: sticky;
	top: 0.5em;
	align-self: start;
	z-index: 4;
	width: auto;
}
.speaker-block .speech__meta-data {
	grid-column: 2;
	grid-row: 1;
	position: sticky;
	top: 0;
	z-index: 5;
	margin: 0;
	padding: 0.25em 0;
	background: rgba(255, 255, 255, 0.94);
}
.speaker-block .speaker-block__section {
	grid-column: 2;
	scroll-margin-top: 4em;
	/* 讓每段內的 .speech__links（position: absolute）錨在該段，而不是整個
	   speaker-block li——否則同講者連續多段時，所有 .speech__links 會疊在
	   block 最底部，只剩最後一段看得到 hover 連結。 */
	position: relative;
}
.speaker-block .speaker-block__section + .speaker-block__section {
	margin-top: 0.5em;
}
@media (prefers-color-scheme: dark) {
	.speaker-block .speech__meta-data {
		background: rgba(13, 19, 29, 0.92);
	}
}
</style>
