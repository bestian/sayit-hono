<template>
	<header class="site-header">
		<a class="skip-link" href="#main-content">
			<span lang="zh">跳到主要內容</span><span lang="en">Skip to main content</span>
		</a>
		<div class="site-header__inner">
			<a class="site-brand" href="/" aria-label="SayIt home">
				<span>SayIt</span>
				<span class="site-brand__descriptor">
					<span lang="zh">公開發言紀錄</span><span lang="en">Public speech archive</span>
				</span>
			</a>
			<nav class="site-nav" aria-label="Primary navigation">
				<a href="/speakers/"><span lang="zh">講者</span><span lang="en">Speakers</span></a>
				<a href="/speeches/"><span lang="zh">對話</span><span lang="en">Speeches</span></a>
			</nav>
			<div class="site-header__actions">
				<slot />
				<form
					v-if="showSearch"
					id="sayit-search"
					class="sayit-search"
					role="search"
					action="/search/"
					method="get"
				>
					<div class="sayit-search__row">
						<div class="sayit-search__input-wrap">
							<input
								id="sayit-search-input"
								name="q"
								type="search"
								class="sayit-search__input"
								autocomplete="off"
								spellcheck="false"
								aria-label="Search exact words, speakers, or sections"
							>
							<span class="sayit-search__shortcut" id="sayit-search-shortcut" aria-hidden="true">/</span>
						</div>
						<button type="submit" class="sayit-search__submit">
							<span lang="zh">搜尋</span><span lang="en">Search</span>
						</button>
					</div>
				</form>
				<button
					v-if="showSearch"
					type="button"
					id="sayit-ask-submit"
					class="homepage-ask__submit"
					hidden
					aria-hidden="true"
				>
					<span lang="zh">向典藏提問</span><span lang="en">Ask archive</span>
				</button>
				<button
					type="button"
					id="sayit-site-lang-toggle"
					class="sayit-site-lang-toggle"
					aria-label="Switch interface language"
				>
					<span lang="zh">介面：華文</span><span lang="en">Interface: English</span>
				</button>
				<button
					type="button"
					class="sayit-share-button"
					data-sayit-share
					aria-controls="sayit-share-feedback"
				>
					<span lang="zh">分享此頁</span><span lang="en">Share page</span>
				</button>
			</div>
		</div>
		<div id="sayit-share-feedback" class="sayit-share-toast" aria-live="polite" aria-atomic="true" hidden></div>
	</header>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ showSearch?: boolean }>(), {
	showSearch: true,
});
</script>
