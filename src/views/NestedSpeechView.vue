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
}>();

const nestedList = computed(() => props.nests ?? []);

const getNestUrl = (nestFilename: string) =>
	`/${encodeURIComponent(props.speechName)}/${encodeURIComponent(nestFilename)}`;
</script>

<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="page-header page-header--speech">
						<ul class="breadcrumbs"></ul>
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
