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

	const loading = false;
	</script>

	<template>
		<div class="page">
			<Navbar />
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
										v-for="section in displaySections"
										:key="section.section_id"
										:id="`s${section.section_id}`"
										:class="[
											'speech',
											'speech--',
											'speech--border',
											section.section_speaker ? 'speech--with-portrait' : ''
										]"
										:style="borderStyle(section)"
									>
										<div class="speaker-portrait-wrapper" v-if="section.section_speaker">
											<img
												:src="section.photoURL || '/static/speeches/i/a.png'"
												:alt="section.name || ''"
												:style="avatarStyle(section)"
												class="speaker-portrait speaker-portrait--left round-image speaker-portrait--medium"
											/>
										</div>
										<div class="speech-wrapper">
											<div class="speech__meta-data">
												<span class="speech__meta-data__speaker-name" v-if="section.section_speaker && section.name">
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
									<h2>Keyboard shortcuts</h2>
									<p>
										<span class="key-descriptor">j</span> previous section
										<span class="key-descriptor">k</span> next section
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
	</style>

