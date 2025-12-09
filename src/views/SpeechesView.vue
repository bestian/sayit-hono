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
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="page-header">
						<h1>Speeches</h1>
					</div>
					<ul class="unstyled">
						<li v-for="speech in speeches" :key="speech.filename">
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

