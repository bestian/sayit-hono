<script setup lang="ts">
import { computed } from 'vue';

interface SpeechItem {
	filename: string;
	display_name: string;
}

const props = defineProps<{
	speeches: SpeechItem[];
	source?: string;
}>();

// 從 display_name 提取日期（格式：YYYY-MM-DD）
function extractDate(displayName: string): string {
	const match = displayName.match(/^(\d{4}-\d{2}-\d{2})/);
	return match ? match[1] : '';
}

// 按日期降序排序（新的在前）
const sortedSpeeches = computed(() => {
	return [...props.speeches].sort((a, b) => {
		const dateA = extractDate(a.display_name);
		const dateB = extractDate(b.display_name);

		// 如果都有日期，按日期降序排序
		if (dateA && dateB) {
			return dateB.localeCompare(dateA);
		}

		// 如果只有一個有日期，有日期的排在前面
		if (dateA && !dateB) return -1;
		if (!dateA && dateB) return 1;

		// 都沒有日期，保持原順序
		return 0;
	});
});
</script>

<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="page-header">
						<h1>Speeches</h1>
					</div>
					<ul class="unstyled">
						<li v-for="speech in sortedSpeeches" :key="speech.filename">
							<span class="section-title">
							<a :href="`/${encodeURIComponent(speech.filename)}`">
								{{ speech.display_name }}
							</a>
							</span>
						</li>
					</ul>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>

<style scoped>
</style>

