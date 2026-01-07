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
								<span
									:class="['button search-pagination-button', hasPrev ? '' : 'button--disabled']"
									:aria-disabled="!hasPrev"
								>
									<template v-if="hasPrev">
										<a :href="pageHref(safePage - 1)">&larr; Previous</a>
									</template>
									<template v-else>&larr; Previous</template>
								</span>
								<template v-for="pageNum in resolvedPaginationPages" :key="pageNum === 'ellipsis' ? 'ellipsis' : pageNum">
									<span
										v-if="pageNum === 'ellipsis'"
										class="pagination__no__border"
									>...</span>
									<a
										v-else-if="pageNum !== safePage"
										:href="pageHref(pageNum as number)"
										class="button pagination__page-number"
									>{{ pageNum }}</a>
									<span
										v-else
										class="button current pagination__page-number"
									>{{ pageNum }}</span>
								</template>
								<span
									:class="['button search-pagination-button', hasNext ? '' : 'button--disabled']"
									:aria-disabled="!hasNext"
								>
									<template v-if="hasNext">
										<a :href="pageHref(safePage + 1)">Next &rarr;</a>
									</template>
									<template v-else>Next &rarr;</template>
								</span>
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

type PaginationPage = number | 'ellipsis';

const props = defineProps<{
	query: string;
	speakers: SpeakerResult[];
	sections: SectionResult[];
	page?: number;
	page_size?: number;
	total_pages?: number;
	total_sections?: number;
	pagination_pages?: PaginationPage[];
}>();

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
	const safe = Number.isFinite(page) ? Math.max(1, Math.min(totalPages.value, Math.floor(page))) : 1;
	return `/search/?page=${safe}&q=${encodedQuery.value}`;
}
</script>
