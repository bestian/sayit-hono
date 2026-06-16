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
							<!-- <div class="homepage-ask__samples" aria-label="範例問句">
								<button type="button" class="homepage-ask__sample" data-sayit-ask-question="什麼是仁工智慧？">什麼是仁工智慧？</button>
								<button type="button" class="homepage-ask__sample" data-sayit-ask-question="什麼是數位民主？">什麼是數位民主？</button>
								<button type="button" class="homepage-ask__sample" data-sayit-ask-question="如何看待開放政府？">如何看待開放政府？</button>
								<button type="button" class="homepage-ask__sample" data-sayit-ask-question="唐鳳對 AI 的看法？">唐鳳對 AI 的看法？</button>
							</div> -->
							<label class="homepage-ask__consent" id="sayit-ask-consent-label">
								<input type="checkbox" id="sayit-ask-consent">
								<span>
									<span lang="zh">我已閱讀並同意 <a href="https://ask.archive.tw/privacy" target="_blank" rel="noopener noreferrer">隱私權政策</a> 和 <a href="https://ask.archive.tw/terms" target="_blank" rel="noopener noreferrer">使用條款</a></span>
									<span lang="en">I have read and agree to the <a href="https://ask.archive.tw/en/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and the <a href="https://ask.archive.tw/en/terms" target="_blank" rel="noopener noreferrer">Terms of Use</a></span>
								</span>
							</label>
							<p id="sayit-ask-status" class="homepage-ask__status" aria-live="polite"></p>
						</div>
						<div class="homepage-search__row">
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
							<button type="button" id="sayit-ask-submit" class="homepage-ask__submit" hidden></button>
						</div>
					</div>
				</div>
				<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden>
				</div>
				<div id="sayit-ask-answer" class="homepage-ask-answer" aria-live="polite" hidden>
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

.homepage-search__row {
	display: flex;
	align-items: stretch;
	gap: 0.65rem;
	width: 100%;
	max-width: 680px;
}

.sayit-search--homepage {
	flex: 1 1 auto;
	min-width: 0;
	width: auto;
	max-width: none;
}

.sayit-search--homepage .sayit-search__input {
	font-size: 1.1em;
	padding: 0.6em 1.1em;
	padding-right: 2.8em;
	border-radius: 8px;
}

.homepage-ask {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.75rem;
	width: 100%;
	max-width: 680px;
	margin-top: 1rem;
	text-align: center;
}

.homepage-ask[hidden] {
	display: none;
}

.homepage-ask__intro,
.homepage-ask__status {
	margin: 0;
	color: #6b6357;
}

.homepage-ask__consent {
	display: flex;
	align-items: flex-start;
	gap: 0.5rem;
	max-width: 680px;
	margin: 0;
	text-align: left;
	font-size: 0.95rem;
	color: #6b6357;
	cursor: pointer;
}

.homepage-ask__consent input {
	margin-top: 1px;
	flex: 0 0 auto;
	accent-color: #c9564b;
}

.homepage-ask__consent a {
	color: #c9564b;
	text-underline-offset: 0.18em;
}

.homepage-ask__consent a:hover {
	color: #a8443b;
}

.homepage-ask__samples {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 0.5rem;
}

.homepage-ask__sample,
.homepage-ask__submit {
	border: 1px solid rgba(201, 86, 75, 0.28);
	border-radius: 999px;
	background: #fffaf4;
	color: #a8443b;
	font: inherit;
	cursor: pointer;
}

.homepage-ask__sample {
	padding: 0.4rem 0.8rem;
}

.homepage-ask__submit {
	flex: 0 0 auto;
	align-self: stretch;
	padding: 0.55rem 1.3rem;
	font-weight: 700;
	white-space: nowrap;
}

.homepage-ask__submit[hidden] {
	display: none;
}

.homepage-ask__sample:hover,
.homepage-ask__sample:focus,
.homepage-ask__submit:hover,
.homepage-ask__submit:focus {
	background: #fdece8;
	outline: none;
}

.homepage-ask__sample:disabled,
.homepage-ask__submit:disabled {
	cursor: not-allowed;
	opacity: 0.62;
}

.homepage-ask-answer {
	width: 100%;
	max-width: 760px;
	margin: 1.5rem auto 0;
	padding: 1.25rem 1.35rem;
	border: 1px solid rgba(199, 194, 186, 0.95);
	border-radius: 16px;
	background: linear-gradient(180deg, #ffffff 0%, #f7f2ec 100%);
	box-shadow: 0 12px 30px rgba(73, 54, 40, 0.08);
	box-sizing: border-box;
	line-height: 1.6;
}

.homepage-ask-answer[hidden] {
	display: none;
}

/* 子元素由 JS 動態插入，需用 :deep() 才能套到 scoped 樣式 */
.homepage-ask-answer :deep(.homepage-ask-answer__status),
.homepage-ask-answer :deep(.homepage-ask-answer__body),
.homepage-ask-answer :deep(.homepage-ask-answer__error) {
	margin: 0;
	line-height: 1.6;
}

.homepage-ask-answer :deep(.homepage-ask-answer__body) {
	white-space: pre-wrap;
	word-break: break-word;
}

.homepage-ask-answer :deep(.homepage-ask-answer__body sup.cite) {
	line-height: 1;
	vertical-align: super;
}

.homepage-ask-answer :deep(.homepage-ask-answer__error) {
	color: #a8443b;
}

.homepage-ask-answer :deep(.homepage-ask-answer__cursor) {
	display: inline-block;
	margin-left: 0.1em;
	animation: ask-cursor-blink 1s steps(1) infinite;
}

.homepage-ask-answer :deep(.homepage-ask-answer__sources) {
	margin-top: 1.35rem;
	padding-top: 0.85rem;
	border-top: 1px solid rgba(199, 194, 186, 0.55);
}

.homepage-ask-answer :deep(.homepage-ask-answer__sources h3) {
	margin: 0 0 0.65rem;
	padding: 0;
	font-size: 1rem;
	line-height: 1.6;
}

.homepage-ask-answer :deep(.homepage-ask-answer__sources ol) {
	margin: 0;
	padding: 0;
	list-style-position: inside;
	line-height: 1.6;
}

.homepage-ask-answer :deep(.homepage-ask-answer__sources li) {
	margin: 0.45rem 0;
	padding: 0;
}

.homepage-ask-answer :deep(.homepage-ask-answer__sources li:first-child) {
	margin-top: 0;
}

.homepage-ask-answer :deep(.homepage-ask-answer__sources li:last-child) {
	margin-bottom: 0;
}

@keyframes ask-cursor-blink {
	50% {
		opacity: 0;
	}
}

@media (max-width: 580px) {
	.homepage-search__row {
		flex-direction: column;
	}

	.homepage-ask__submit {
		width: 100%;
	}
}

@media (prefers-color-scheme: dark) {
	.homepage-ask__intro,
	.homepage-ask__status,
	.homepage-ask__consent {
		color: var(--sayit-text-muted, #b8c4d1);
	}

	.homepage-ask__consent a {
		color: var(--sayit-link, #9fc2ff);
	}

	.homepage-ask__consent a:hover {
		color: var(--sayit-link-hover, #ffd0c7);
	}

	.homepage-ask__sample,
	.homepage-ask__submit {
		border-color: rgba(127, 214, 176, 0.36);
		background: rgba(18, 26, 37, 0.92);
		color: var(--sayit-link-hover, #ffd0c7);
	}

	.homepage-ask__sample:hover,
	.homepage-ask__sample:focus,
	.homepage-ask__submit:hover,
	.homepage-ask__submit:focus {
		background: rgba(24, 35, 49, 0.98);
	}

	.homepage-ask-answer {
		border-color: var(--sayit-border, rgba(164, 184, 204, 0.14));
		background: linear-gradient(180deg, rgba(20, 29, 42, 0.96), rgba(13, 20, 31, 0.9));
		color: var(--sayit-text, #ecf2f8);
		box-shadow: 0 14px 28px rgba(0, 0, 0, 0.18);
	}
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
