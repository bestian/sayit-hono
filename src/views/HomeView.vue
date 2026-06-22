<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
			<div class="full-page__unit">
				<div class="page-content__row">
					<div class="homepage-search">
						<h2><span lang="zh">搜尋對話與發言</span><span lang="en">Search speeches and statements</span></h2>
						<div id="sayit-ask" class="homepage-ask" hidden>
							<p class="homepage-ask__intro">
								<span lang="zh">或直接提問，讓 AI 從逐字稿中找出回答：</span>
								<span lang="en">Or ask a question and let AI search the transcripts:</span>
							</p>
							<p id="sayit-ask-status" class="homepage-ask__status" aria-live="polite"></p>
						</div>
						<div class="homepage-search__row">
							<div id="sayit-search" class="sayit-search sayit-search--homepage" role="search">
								<div class="sayit-search__row">
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
									<button type="button" class="sayit-search__submit" aria-label="Search">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
									</button>
								</div>
							</div>
							<button type="button" id="sayit-ask-submit" class="homepage-ask__submit" hidden aria-hidden="true"></button>
					</div>
				</div>
				<div id="sayit-ask-answer" class="homepage-ask-answer" aria-live="polite" hidden>
				</div>
				<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden>
				</div>
			</div>
			<div class="homepage-stats" id="sayit-stats">
			<div class="full-page__row">
				<div class="full-page__unit">
				<a href="/speeches"><strong id="sayit-stat-speeches"></strong></a> <span lang="zh">篇發言</span><span lang="en">speeches</span>;
				<a href="/speakers"><strong id="sayit-stat-speakers"></strong></a> <span lang="zh">位講者</span><span lang="en">speakers</span>;
				<a href="/speeches"><strong id="sayit-stat-sections"></strong></a> <span lang="zh">場會議</span><span lang="en">sections</span>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.homepage-search {
	display: flex;
	flex-direction: column;
	align-items: center;
}

.homepage-search__row {
	display: flex;
	align-items: stretch;
	gap: 0.65rem;
	width: 100%;
	max-width: 680px;
}

.homepage-stats .full-page__unit {
	font-size: 1.15em;
	color: #6b6357;
}

.homepage-stats a { text-decoration: none; }

.homepage-stats strong {
	font-weight: 700;
	color: #c9564b;
}

.homepage-stats a:hover strong { color: #a8443b; }

@media (max-width: 580px) {
	.homepage-search__row { flex-direction: column; }
}
</style>
