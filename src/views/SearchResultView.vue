<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<h1 class="search-title-with-result">搜尋 / <strong>{{ query }}</strong></h1>
					<form class="site-search site-search--on-results-page" action="/search/" method="get">
						<div class="search-wrapper">
							<input type="search" class="site-search__input" placeholder="搜尋" name="q" :value="query" />
							<input type="submit" class="icon-search" value="搜尋" />
						</div>
					</form>
					<div class="page-content__row ">
						<div class="full-page__unit">
							<h2>Speakers</h2>
							<ul class="unstyled-list search-results-speakers">
								<li v-for="speaker in speakers" :key="speaker.route_pathname" class="search">
									<a :href="`/speaker/${speaker.route_pathname}`">
										<span v-html="speaker.snippet || speaker.name"></span>
									</a>
								</li>
								<li v-if="speakers.length === 0" class="search">沒有相關講者</li>
							</ul>
							<h2>Mentions of <strong>&ldquo;{{ query }}&rdquo;</strong> in speeches</h2>
							<ul class="unstyled-list search-results-list">
								<li
									v-for="section in sections"
									:key="section.section_id"
									class="speech speech--search-result speech--with-portrait speech--speech speech--border"
									:style="sectionBorderStyle(section)"
								>
									<div class="speaker-portrait-wrapper">
										<img
											:src="section.photoURL || '/static/speeches/i/a.png'"
											:alt="section.speaker_name || ''"
											:style="avatarStyle(section)"
											class="speaker-portrait speaker-portrait--left round-image speaker-portrait--medium"
										>
									</div>
									<div class="speech-wrapper">
										<div class="speech__breadcrumb">
											<ul class="breadcrumbs">
												<li>
													<a :href="sectionLink(section)">{{ section.display_name }}</a>
												</li>
											</ul>
										</div>
										<div class="speech__meta-data">
											<span v-if="section.speaker_name" class="speech__meta-data__speaker-name">
												<a :href="section.section_speaker ? `/speaker/${section.section_speaker}` : undefined">
													{{ section.speaker_name }}
												</a>
											</span>
										</div>
										<div class="speech__content">
											<p class="search">
												<a title="Link in context" :href="sectionLink(section)" v-html="section.snippet"></a>
											</p>
										</div>
									</div>
								</li>
								<li v-if="sections.length === 0" class="speech speech--search-result speech--with-portrait speech--speech speech--border">
									<div class="speech-wrapper">
										<div class="speech__content">沒有找到相關段落</div>
									</div>
								</li>
							</ul>
							<div class="pagination">
								<span class="button--disabled button search-pagination-button">&larr; Previous</span>
								<span class="button current pagination__page-number">1</span>
								<a :href="pageHref(2)" class="button pagination__page-number">2</a>
								<a :href="pageHref(3)" class="button pagination__page-number">3</a>
								...
								<a :href="pageHref(91)" class="button pagination__page-number">91</a>
								<a :href="pageHref(92)" class="button pagination__page-number">92</a>
								<a :href="pageHref(2)" class="button search-pagination-button">Next &rarr;</a>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

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

const props = defineProps<{
	query: string;
	speakers: SpeakerResult[];
	sections: SectionResult[];
}>();

const encodedQuery = computed(() => encodeURIComponent(props.query ?? ''));
const borderPalette = ['#4d89d2', '#b17656', '#c17660', '#f5b68d', '#9c245d', '#6229d3', '#01055f', '#15895c', '#8a279e', '#1e27b1'];

function hashString(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash << 5) - hash + value.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

function sectionBorderStyle(section: SectionResult) {
	const key = section.section_speaker || section.filename || '';
	const index = key ? hashString(key) % borderPalette.length : 0;
	return { borderColor: borderPalette[index] };
}

function avatarStyle(section: SectionResult) {
	const key = section.section_speaker || section.filename || '';
	const index = key ? hashString(key) % borderPalette.length : 0;
	return { borderColor: borderPalette[index], backgroundColor: borderPalette[index] };
}

function sectionLink(section: SectionResult) {
	const encodedFilename = encodeURIComponent(section.filename);
	const encodedNest = section.nest_filename ? `/${encodeURIComponent(section.nest_filename)}` : '';
	return `/${encodedFilename}${encodedNest}#s${section.section_id}`;
}

function pageHref(page: number) {
	const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
	return `/search/?page=${safePage}&q=${encodedQuery.value}`;
}
</script>
