<script setup lang="ts">
	import { computed } from 'vue';
	import { getSpeakerColor } from '../utils/speakerColor';

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

	interface SpeakerBlock {
		id: number;
		speaker: string | null;
		name: string | null;
		photoURL: string | null;
		color: string;
		sections: Section[];
	}

	type SiblingNest = {
		nest_filename: string;
		nest_display_name?: string | null;
	};

	const props = defineProps<{
		sections: Section[];
		speechName: string;
		nestFilename: string;
		displayName?: string;
		speechDisplayName?: string;
		siblings?: SiblingNest[];
		alternateUrl?: string | null;
		alternateLabel?: string | null;
	}>();

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

	const colorForSection = (section: Section): string => {
		const key =
			section.section_speaker ||
			section.name ||
			section.filename ||
			(section.display_name ?? '')
		return getSpeakerColor(key);
	};

	// 同 SingleSpeechView：把連續同一講者的 section 合併成一個 block。
	const speakerBlocks = computed<SpeakerBlock[]>(() => {
		const blocks: SpeakerBlock[] = [];
		let current: SpeakerBlock | null = null;
		for (const section of displaySections.value) {
			const speaker = section.section_speaker ?? null;
			if (current && current.speaker === speaker) {
				current.sections.push(section);
				continue;
			}
			current = {
				id: section.section_id,
				speaker,
				name: section.name,
				photoURL: section.photoURL,
				color: colorForSection(section),
				sections: [section],
			};
			blocks.push(current);
		}
		return blocks;
	});

	const blockBorderStyle = (block: SpeakerBlock) =>
		block.speaker ? { borderLeftColor: block.color } : {};

	const blockAvatarStyle = (block: SpeakerBlock) => ({
		borderColor: block.color,
		backgroundColor: block.color,
	});

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

	const loading = false;
	</script>

	<template>
		<div class="page">
			<Navbar>
				<div id="sayit-search" class="sayit-search" role="search">
					<div class="sayit-search__input-wrap">
						<input id="sayit-search-input" type="search" class="sayit-search__input" autocomplete="off" spellcheck="false" aria-label="Search speeches">
						<span class="sayit-search__shortcut" id="sayit-search-shortcut" aria-hidden="true">/</span>
					</div>
				</div>
				<a v-if="alternateUrl" :href="alternateUrl" class="sayit-lang-switch" :title="alternateLabel">
					{{ alternateLabel }}
				</a>
			</Navbar>
			<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden></div>
			<div class="full-page">
				<div class="full-page__row">
					<div class="full-page__unit">
						<div class="page-header page-header--speech">
							<ul class="breadcrumbs">
								<li>
									<a :href="getNestListUrl()">{{ formattedParentTitle }}</a>
								</li>
							</ul>
							<h1>{{ formattedTitle }}</h1>
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
											<img
												:src="block.photoURL || '/static/speeches/i/a.png'"
												:alt="block.name || ''"
												:style="blockAvatarStyle(block)"
												class="speaker-portrait speaker-portrait--left round-image speaker-portrait--medium"
											/>
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
								<div class="section-navigation">
									<a
										v-if="previousSibling"
										class="button speech-navigation__button"
										:href="getNestUrl(previousSibling.nest_filename)"
										data-prev-btn
									>
									   ← {{ formattedPreviousSiblingTitle }}
									</a>
									<a
										v-if="nextSibling"
										class="button speech-navigation__button"
										:href="getNestUrl(nextSibling.nest_filename)"
										data-next-btn
									>
									{{ formattedNextSiblingTitle }} →
									</a>
								</div>
								<div class="ui-instructions cleared">
									<h2><span lang="zh">鍵盤快捷鍵</span><span lang="en">Keyboard shortcuts</span></h2>
									<p>
										<span class="key-descriptor">j</span> <span lang="zh">下一段</span><span lang="en">next section</span>
										<span class="key-descriptor">k</span> <span lang="zh">上一段</span><span lang="en">previous section</span>
									</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
			<Footer />
		</div>
	</template>

	<style scoped>
	.breadcrumbs {
		margin: 0 0 0.5rem;
	}
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
