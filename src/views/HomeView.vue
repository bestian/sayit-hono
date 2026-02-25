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
				<a href="/speeches"><strong id="sayit-stat-speeches"></strong></a> <span lang="zh">篇發言</span><span lang="en">speeches</span>;
				<a href="/speakers"><strong id="sayit-stat-speakers"></strong></a> <span lang="zh">位講者</span><span lang="en">speakers</span>;
				<a href="/speeches"><strong id="sayit-stat-sections"></strong></a> <span lang="zh">場會議</span><span lang="en">sections</span>
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
.homepage-search {
	display: flex;
	flex-direction: column;
	align-items: center;
}

.sayit-search--homepage {
	width: 100%;
	max-width: 520px;
}

.sayit-search--homepage .sayit-search__input {
	font-size: 1.1em;
	padding: 0.6em 1.1em;
	padding-right: 2.8em;
	border-radius: 8px;
}

.homepage-stats .full-page__unit {
	font-size: 1.15em;
	color: #6b6357;
}

.homepage-stats a {
	text-decoration: none;
}

.homepage-stats strong {
	font-weight: 700;
	color: #c9564b;
}

.homepage-stats a:hover strong {
	color: #a8443b;
}
</style>
