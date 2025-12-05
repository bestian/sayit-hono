<script setup lang="ts">
interface SpeechItem {
	filename: string;
	display_name: string;
}

defineProps<{
	speeches: SpeechItem[];
	source?: string;
}>();
</script>

<template>
	<div class="page">
		<Navbar />
		<main class="page__content">
			<h1>Speeches</h1>
			<p>以下列表會透過 D1 的 <code>speech_index</code> 資料表生成。</p>

			<ul class="speech-list" v-if="speeches.length > 0">
				<li v-for="speech in speeches" :key="speech.filename">
					<a class="speech-link" :href="`/${encodeURIComponent(speech.filename)}`">
						{{ speech.display_name }}
					</a>
				</li>
			</ul>
			<p v-else class="empty">暫無資料，請確認 D1 內是否已有 speech_index。</p>

			<p class="source" v-if="source">資料來源：{{ source }}</p>
		</main>
		<Footer />
	</div>
</template>

<style>
.page {
	min-height: 100vh;
	margin: 0;
	display: grid;
	gap: 24px;
	background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
	font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	color: #0f172a;
}

.page__content {
	padding: 64px 24px;
	display: grid;
	gap: 16px;
}

h1 {
	margin: 0;
	font-size: 2.25rem;
}

.speech-list {
	list-style: none;
	padding: 0;
	margin: 0;
	display: grid;
	gap: 8px;
}

.speech-link {
	color: #0ea5e9;
	text-decoration: none;
	font-weight: 600;
}

.speech-link:hover {
	text-decoration: underline;
}

.empty {
	color: #475569;
}

.source {
	color: #475569;
	font-size: 0.9rem;
}
</style>

