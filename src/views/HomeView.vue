<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
			<div class="full-page__unit">
				<div class="page-content__row">
					<div class="homepage-search">
						<h2><span lang="zh">搜尋對話與發言</span><span lang="en">Search speeches and statements</span></h2>
						<form class="site-search site-search--homepage" action="/search/" method="get">
						<div class="search-wrapper">
							<input type="search" class="site-search__input" placeholder="Search" name="q" />
							<input type="submit" class="icon-search icon-search" value="Search" />
						</div>
						</form>
					</div>
				</div>
			</div>
			</div>
			<div class="homepage-stats">
			<div class="full-page__row">
				<div class="full-page__unit">
				<a href="/speeches"><strong>{{ speechesCount }}</strong></a> <span lang="zh">篇對話</span><span lang="en">speeches</span>;
				<a href="/speakers"><strong>{{ speakersCount }}</strong></a> <span lang="zh">位講者</span><span lang="en">speakers</span>;
				<a href="/speeches"><strong>{{ sectionsCount }}</strong></a> <span lang="zh">個段落</span><span lang="en">sections</span>
				</div>
			</div>
			<div class="full-page__row">
				<div class="full-page__unit"></div>
			</div>
			</div>
		</div>
		<Footer />
	</div>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		speechesCount?: string;
		speakersCount?: string;
		sectionsCount?: string;
	}>(),
	{ speechesCount: '0', speakersCount: '0', sectionsCount: '0' }
);
</script>

<style scoped>
a {
	cursor: pointer !important;
}
</style>

