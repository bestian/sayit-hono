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
						<h1><span lang="zh">對話</span><span lang="en">Speeches</span></h1>
					</div>

					<!-- Pagefind search widget -->
					<div id="sayit-search" class="sayit-search" role="search">
						<div class="sayit-search__input-wrap">
							<input
								id="sayit-search-input"
								type="search"
								class="sayit-search__input"
								autocomplete="off"
								spellcheck="false"
								aria-label="Search speeches"
							>
							<span class="sayit-search__shortcut" id="sayit-search-shortcut" aria-hidden="true">/</span>
						</div>
						<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden>
						</div>
					</div>

					<ul class="unstyled" id="sayit-speech-list">
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

<style>
/* Non-scoped: search results are rendered by client-side JS */
.sayit-search {
	margin: 0.25em 0 1.8em;
}

.sayit-search__input-wrap {
	position: relative;
	max-width: 100%;
}

.sayit-search__input {
	display: block;
	width: 100%;
	padding: 0.7em 1em;
	padding-right: 2.8em;
	font-family: 'Noto Sans TC', sans-serif;
	font-size: 1.05em;
	font-weight: 400;
	line-height: 1.5;
	color: #2c2c2c;
	background: #fafaf8;
	border: 1.5px solid #d4d0c8;
	border-radius: 6px;
	outline: none;
	transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
	box-sizing: border-box;
	-webkit-appearance: none;
}

.sayit-search__input::placeholder {
	color: #9e998e;
	font-weight: 300;
}

.sayit-search__input:focus {
	border-color: #8b7e6a;
	background: #fff;
	box-shadow: 0 0 0 3px rgba(139, 126, 106, 0.1);
}

/* WebKit search input reset */
.sayit-search__input::-webkit-search-decoration,
.sayit-search__input::-webkit-search-cancel-button {
	-webkit-appearance: none;
}

.sayit-search__shortcut {
	position: absolute;
	right: 0.8em;
	top: 50%;
	transform: translateY(-50%);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.6em;
	height: 1.6em;
	font-family: monospace, 'Noto Sans TC', sans-serif;
	font-size: 0.8em;
	font-weight: 500;
	color: #a09888;
	background: #eeedea;
	border: 1px solid #d8d4cc;
	border-radius: 4px;
	pointer-events: none;
	transition: opacity 0.25s ease;
}

/* Hide shortcut badge on touch devices */
@media (hover: none) {
	.sayit-search__shortcut {
		display: none;
	}
}

.sayit-search__results {
	margin-top: 0.4em;
	overflow: hidden;
}

.sayit-search__results[hidden] {
	display: none;
}

/* Fade-in animation for search results */
.sayit-search__results-inner {
	animation: sayit-fade-in 0.2s ease;
}

.sayit-search__status {
	padding: 0.7em 0;
	font-size: 0.85em;
	color: #9e998e;
	font-weight: 300;
	letter-spacing: 0.01em;
}

.sayit-search__result {
	display: block;
	padding: 0.85em 0.5em;
	margin: 0 -0.5em;
	border-bottom: 1px solid #eeedea;
	text-decoration: none;
	color: inherit;
	border-radius: 4px;
	transition: background 0.15s ease;
}

.sayit-search__result:last-of-type {
	border-bottom: none;
}

.sayit-search__result:hover {
	background: #f5f4f0;
}

.sayit-search__result-title {
	font-size: 1em;
	font-weight: 500;
	color: #2c2c2c;
	line-height: 1.45;
	margin: 0;
	word-break: break-word;
}

.sayit-search__result:hover .sayit-search__result-title {
	color: #3a7d5c;
}

.sayit-search__result-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5em;
	margin-top: 0.2em;
	font-size: 0.8em;
	color: #a09888;
	font-weight: 400;
}

.sayit-search__result-excerpt {
	margin-top: 0.3em;
	font-size: 0.88em;
	line-height: 1.65;
	color: #5a5650;
	font-weight: 400;
	word-break: break-word;
	overflow-wrap: break-word;
}

.sayit-search__result-excerpt mark {
	background: rgba(201, 180, 120, 0.3);
	color: inherit;
	padding: 0.05em 0.15em;
	border-radius: 2px;
	font-weight: 500;
}

.sayit-search__loading {
	display: flex;
	align-items: center;
	gap: 0.6em;
	padding: 0.8em 0;
	font-size: 0.85em;
	color: #9e998e;
	font-weight: 300;
}

.sayit-search__spinner {
	width: 0.9em;
	height: 0.9em;
	border: 1.5px solid #e0ddd6;
	border-top-color: #8b7e6a;
	border-radius: 50%;
	animation: sayit-spin 0.6s linear infinite;
}

.sayit-search__more {
	display: block;
	padding: 0.75em 0 0.25em;
	font-size: 0.85em;
	color: #8b7e6a;
	text-decoration: none;
	text-align: center;
	transition: color 0.15s ease;
}

.sayit-search__more:hover {
	color: #3a7d5c;
	text-decoration: underline;
}

@keyframes sayit-spin {
	to { transform: rotate(360deg); }
}

@keyframes sayit-fade-in {
	from { opacity: 0; transform: translateY(-4px); }
	to { opacity: 1; transform: translateY(0); }
}

/* Mobile: prevent iOS zoom on focus */
@media (max-width: 640px) {
	.sayit-search__input {
		font-size: 16px;
	}
}
</style>

