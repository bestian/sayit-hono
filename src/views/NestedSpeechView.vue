<script setup lang="ts">
import { computed } from 'vue';

type NestedItem = {
	nest_filename: string;
	nest_display_name: string;
	section_count?: number;
	preview?: string;
};

const props = defineProps<{
	nests: NestedItem[];
	speechName: string;
	displayName: string;
	alternateUrl?: string | null;
	alternateLabel?: string | null;
}>();

const nestedList = computed(() => props.nests ?? []);
const isChineseRecord = computed(
	() => props.alternateLabel === 'English' || /[\u3400-\u9fff]/u.test(props.displayName),
);

// Split a leading YYYY-MM-DD date off the page title so it can be wrapped in <time>.
const heading = computed(() => {
	const text = props.displayName;
	return /^\d{4}-\d{2}-\d{2}/.test(text)
		? { date: text.slice(0, 10), rest: text.slice(10) }
		: { date: null, rest: text };
});

const getNestUrl = (nestFilename: string) =>
	`/${encodeURIComponent(props.speechName)}/${encodeURIComponent(nestFilename)}`;
</script>

<template>
	<div class="page">
		<Navbar />
		<main id="main-content">
			<div class="sayit-ask-overlay">
				<div id="sayit-ask-answer" class="homepage-ask-answer" aria-live="polite" hidden></div>
			</div>
			<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden></div>
			<div class="full-page">
				<div class="full-page__row">
					<div class="full-page__unit">
						<header class="page-header page-header--speech">
							<div class="page-header__title-row">
								<h1 id="page-title" :class="{ 'jf-lanyanghei-extrabold': isChineseRecord }"><time v-if="heading.date" :datetime="heading.date">{{ heading.date }}</time>{{ heading.rest }}</h1>
								<a
									v-if="alternateUrl && alternateLabel"
									:href="alternateUrl"
									class="record-twin-button"
									:lang="alternateLabel === 'English' ? 'en' : 'zh-Hant'"
									:aria-label="alternateLabel === 'English' ? 'Read English transcript' : '閱讀華文逐字稿'"
								>
									{{ alternateLabel === 'English' ? 'English' : '華文' }}
								</a>
							</div>
						</header>
						<div class="page-content__row">
							<article class="primary-content__unit" aria-labelledby="page-title">
								<ol class="section-list">
									<li
										v-for="nest in nestedList"
										:key="nest.nest_filename"
										class="speech speech--section-signpost"
									>
										<span class="section-title">
											<a :href="getNestUrl(nest.nest_filename)">
												{{ nest.nest_display_name || nest.nest_filename }}
												<small v-if="nest.section_count">({{ nest.section_count }})</small>
											</a>
										</span>
									</li>
								</ol>
							</article>
						</div>
					</div>
				</div>
			</div>
		</main>
		<Footer />
	</div>
</template>
