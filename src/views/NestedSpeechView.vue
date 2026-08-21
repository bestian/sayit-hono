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
							<h1>{{ displayName }}</h1>
						</header>
						<div class="page-content__row">
							<div class="primary-content__unit">
								<ul class="section-list">
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
								</ul>
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>
		<Footer />
	</div>
</template>
