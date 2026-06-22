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

const getNestUrl = (nestFilename: string) =>
	`/${encodeURIComponent(props.speechName)}/${encodeURIComponent(nestFilename)}`;
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
						<h1>{{ displayName }}</h1>
					</div>
					<div class="page-content__row">
						<div class="primary-content__unit">
							<ul class="section-list">
								<li
									v-for="nest in nestedList"
									:key="nest.nest_filename"
									class="speech speech--section-signpost speech--with-portrait"
								>
									<div class="speaker-portrait-wrapper">
										<span class="section-dot"></span>
									</div>
									<div class="speech-wrapper">
										<span class="section-title">
											<a :href="getNestUrl(nest.nest_filename)">
												{{ nest.nest_display_name || nest.nest_filename }}
											</a>
										</span>
										<template v-if="nest.section_count"> ({{ nest.section_count }})</template>
									</div>
								</li>
							</ul>
						</div>
						<div class="sidebar__unit section-detail-sidebar"></div>
					</div>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>
