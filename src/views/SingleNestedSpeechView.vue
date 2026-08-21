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

	const recordLanguage = computed(() => {
		const sample = displaySections.value
			.slice(0, 8)
			.map((section) => section.section_content)
			.join(' ');
		return /[\u3400-\u9fff]/u.test(sample) ? 'zh-Hant' : 'en';
	});

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

	const blockStyle = (block: SpeakerBlock): Record<string, string> => ({
		'--speaker-color': block.speaker ? block.color : 'var(--rule)',
	});

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
				<a
					v-if="alternateUrl && alternateLabel"
					:href="alternateUrl"
					class="sayit-lang-switch"
					:aria-label="alternateLabel === 'English' ? 'Read English transcript' : '讀華文逐字稿'"
				>
					<span lang="zh">{{ alternateLabel === 'English' ? '閱讀英語逐字稿' : '閱讀華文逐字稿' }}</span>
					<span lang="en">{{ alternateLabel === 'English' ? 'Read English transcript' : 'Read 華文 transcript' }}</span>
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
								<nav aria-label="Breadcrumb">
									<ul class="breadcrumbs">
										<li><a :href="getNestListUrl()">{{ formattedParentTitle }}</a></li>
									</ul>
								</nav>
								<h1>{{ formattedTitle }}</h1>
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
													:alt="block.name || ''"
													:style="blockAvatarStyle(block)"
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
												<details class="turnline__share-menu">
													<summary
														class="turnline__anchor"
														:title="recordLanguage === 'zh-Hant' ? '段落分享選項' : 'Turn sharing options'"
														:aria-label="recordLanguage === 'zh-Hant' ? `發言段落 ${section.section_id} 的分享選項` : `Sharing options for turn ${section.section_id}`"
													></summary>
													<div
														class="turnline__share-actions"
														role="group"
														:aria-label="recordLanguage === 'zh-Hant' ? '選擇分享方式' : 'Choose sharing mode'"
													>
														<button
															type="button"
															class="turnline__share-option"
															data-sayit-share
															:data-share-url="getLinkInContextUrl(section)"
															:data-share-title="section.display_name"
														>
															<template v-if="recordLanguage === 'zh-Hant'">連同前後文分享</template>
															<template v-else>Share with context</template>
														</button>
														<button
															type="button"
															class="turnline__share-option"
															data-sayit-share
															:data-share-url="`/speech/${section.section_id}`"
															:data-share-title="section.display_name"
														>
															<template v-if="recordLanguage === 'zh-Hant'">分享單一段落</template>
															<template v-else>Share this turn only</template>
														</button>
													</div>
												</details>
												<div
													class="speech__content record-copy"
													:lang="recordLanguage"
													v-html="sanitizeHtmlContent(section.section_content)"
												></div>
											</article>
										</li>
									</ol>
								</div>
								<aside class="sidebar__unit section-detail-sidebar" aria-label="Section navigation">
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
									<div class="ui-instructions">
										<h2><span lang="zh">鍵盤快捷鍵</span><span lang="en">Keyboard shortcuts</span></h2>
										<p>
											<span class="key-descriptor">j</span> <span lang="zh">下一段</span><span lang="en">next section</span>
											<span class="key-descriptor">k</span> <span lang="zh">上一段</span><span lang="en">previous section</span>
										</p>
									</div>
								</aside>
							</div>
						</div>
					</div>
				</div>
			</main>
			<Footer />
		</div>
	</template>
