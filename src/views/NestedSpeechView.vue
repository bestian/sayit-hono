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
						<h1>{{ displayName }}</h1>
						<p class="page-header__subtitle">
							這是一個巢狀演講，請選擇子場次以檢視內容。
						</p>
					</div>
					<ul class="unstyled nested-speech-list">
						<li v-for="nest in nestedList" :key="nest.nest_filename" class="nested-speech-list__item">
							<div class="section-title">
								<a :href="getNestUrl(nest.nest_filename)">
									{{ nest.nest_display_name || nest.nest_filename }}
								</a>
							</div>
							<div class="nested-speech-list__meta" v-if="nest.section_count">
								共 {{ nest.section_count }} 段
							</div>
							<p class="nested-speech-list__preview" v-if="nest.preview">
								{{ nest.preview }}
							</p>
						</li>
					</ul>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>

<style scoped>
.nested-speech-list {
	display: grid;
	gap: 1.5rem;
	padding: 0;
}

.nested-speech-list__item {
	border: 1px solid #e0e0e0;
	border-radius: 8px;
	padding: 1.25rem;
	background: #fff;
}

.nested-speech-list__meta {
	color: #666;
	margin-top: 0.25rem;
	font-size: 0.95rem;
}

.nested-speech-list__preview {
	margin: 0.5rem 0 0;
	color: #444;
	line-height: 1.5;
}

.page-header__subtitle {
	color: #666;
	margin: 0.5rem 0 0;
}
</style>

