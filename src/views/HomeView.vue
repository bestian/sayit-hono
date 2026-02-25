<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
			<div class="full-page__unit">
				<div class="page-content__row">
					<div class="homepage-search">
						<h2><span lang="zh">搜尋對話與發言</span><span lang="en">Search speeches and statements</span></h2>
						<div id="sayit-search" class="sayit-search sayit-search--homepage" role="search">
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
						</div>
					</div>
				</div>
				<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden>
				</div>
			</div>
			</div>
			<div class="homepage-stats" id="sayit-stats">
			<div class="full-page__row">
				<div class="full-page__unit">
				<a href="/speeches"><strong id="sayit-stat-speeches"></strong> <span lang="zh">篇對話</span><span lang="en">speeches</span></a>;
				<a href="/speakers"><strong id="sayit-stat-speakers"></strong> <span lang="zh">位講者</span><span lang="en">speakers</span></a>
				</div>
			</div>
			</div>
		</div>
		<Footer />
	</div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.sayit-search--homepage {
	width: 100%;
	max-width: 480px;
}

.sayit-search--homepage .sayit-search__input {
	font-size: 1.05em;
	padding: 0.55em 1em;
	padding-right: 2.6em;
}

a {
	cursor: pointer !important;
}
</style>
