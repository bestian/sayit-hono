<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<h1 class="search-title-with-result"><span lang="zh">搜尋</span><span lang="en">Search</span> / <strong>{{ query }}</strong></h1>
					<form class="site-search site-search--on-results-page" action="/search/" method="get">
						<div class="search-wrapper">
							<input type="search" class="site-search__input" placeholder="Search" name="q" :value="query" />
							<input type="submit" class="icon-search" value="Search" />
						</div>
					</form>
					<div class="page-content__row ">
						<div class="full-page__unit">
							<!-- 當有講者篩選時，顯示 checkbox -->
							<template v-if="filteredSpeakerId && filteredSpeakerName">
								<label>
									<input type="checkbox" name="p" :value="filteredSpeakerId" checked>
									<span lang="zh">僅搜尋 {{ filteredSpeakerName }} 的發言</span><span lang="en">Search only speeches by {{ filteredSpeakerName }}</span>
								</label>
							</template>
							<!-- 沒有講者篩選時，顯示原本的 Speakers 區塊 -->
							<template v-else>
								<h2><span lang="zh">講者</span><span lang="en">Speakers</span></h2>
								<ul class="unstyled-list search-results-speakers">
									<li v-for="speaker in speakers" :key="speaker.route_pathname" class="search">
										<a :href="`/speaker/${speaker.route_pathname}`">
											<span v-html="speaker.snippet || speaker.name"></span>
										</a>
									</li>
									<li v-if="speakers.length === 0" class="search"><span lang="zh">沒有符合的講者。</span><span lang="en">There are no speakers that match your search.</span></li>
								</ul>
							</template>
							<h2><span lang="zh">在對話中提及 <strong>&ldquo;{{ query }}&rdquo;</strong></span><span lang="en">Mentions of <strong>&ldquo;{{ query }}&rdquo;</strong> in speeches</span></h2>
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
										<div class="speech__content"><span lang="zh">沒有找到相關段落</span><span lang="en">No matching sections found.</span></div>
									</div>
								</li>
							</ul>
							<div class="pagination">
								<span
									:class="['button search-pagination-button', hasPrev ? '' : 'button--disabled']"
									:aria-disabled="!hasPrev"
								>
									<template v-if="hasPrev">
										<a :href="pageHref(safePage - 1)">&larr; <span lang="zh">上一頁</span><span lang="en">Previous</span></a>
									</template>
									<template v-else>&larr; <span lang="zh">上一頁</span><span lang="en">Previous</span></template>
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
										<a :href="pageHref(safePage + 1)"><span lang="zh">下一頁</span><span lang="en">Next</span> &rarr;</a>
									</template>
									<template v-else><span lang="zh">下一頁</span><span lang="en">Next</span> &rarr;</template>
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
import { getSpeakerColor } from '../utils/speakerColor';

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
	filteredSpeakerId?: number;
	filteredSpeakerName?: string | null;
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

// 供 SSR 使用：有講者篩選時帶入分頁與連結
const speakerIdForFilter = computed(() => (props.filteredSpeakerId ? props.filteredSpeakerId.toString() : null));

function colorKey(section: SectionResult) {
	return section.section_speaker || section.filename || section.speaker_name || '';
}

function sectionBorderStyle(section: SectionResult) {
	const color = getSpeakerColor(colorKey(section));
	return { borderColor: color };
}

function avatarStyle(section: SectionResult) {
	const color = getSpeakerColor(colorKey(section));
	return { borderColor: color, backgroundColor: color };
}

function sectionLink(section: SectionResult) {
	const encodedFilename = encodeURIComponent(section.filename);
	const encodedNest = section.nest_filename ? `/${encodeURIComponent(section.nest_filename)}` : '';
	return `/${encodedFilename}${encodedNest}#s${section.section_id}`;
}

function pageHref(page: number) {
	const safe = Number.isFinite(page) ? Math.max(1, Math.min(totalPages.value, Math.floor(page))) : 1;

	// 從 props 或當前 URL 取得 p 參數（講者 ID）
	let speakerIdParam = '';
	const speakerId = speakerIdForFilter.value;
	if (speakerId) {
		speakerIdParam = `&p=${encodeURIComponent(speakerId)}`;
	}

	return `/search/?page=${safe}&q=${encodedQuery.value}${speakerIdParam}`;
}
</script>
