<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit legal-page">
					<h1><span lang="zh">隱私權政策</span><span lang="en">Privacy Policy</span></h1>
					<section class="legal-page__section" aria-labelledby="privacy-zh">
						<h2 id="privacy-zh"><span lang="zh">華語</span></h2>
						<div lang="zh">
							<p>我們希望本站 AI 提問功能能成為友善、開放、可持續的公共知識入口，讓更多人安心提問、分享與學習。</p>
							<p>我們不會販售或交換您的個人資料，也不會為廣告目的替您建立個人檔案。</p>
							<p>當您在搜尋框提出問題時，服務會收集並保留您提出的問題，用於產生回覆、維護服務品質、偵測濫用與處理資安事件。</p>
							<p>為了讓服務穩定、對每位使用者公平，並防止濫用、攻擊、繞過限流或大量自動化請求，我們也會收集並保留必要的防濫用資訊，包括連線 IP、網站使用者識別碼（如有）、請求時間、限流紀錄與相關技術紀錄。</p>
							<p>上述資訊只會用於提供服務、維護服務安全、偵測異常流量、建立或執行防濫用名單、處理資安事件，以及遵循法律或主管機關要求；不會用於廣告投放，也不會出售給第三方。除非發現濫用、攻擊、規避限流或其他不當使用疑慮，或依法必須提供，否則我們不會將您的提問內容或可識別資訊提供給第三方。</p>
							<p>本服務依 Cloudflare Workers 等基礎設施的運作機制接收必要的請求資訊。除為提供服務、維護安全、防止濫用或依法所需外，我們不會主動蒐集或留存其他可識別您的個人資料。</p>
						</div>
					</section>
					<section class="legal-page__section legal-page__section--alt" aria-labelledby="privacy-en">
						<h2 id="privacy-en"><span lang="en">English</span></h2>
						<div lang="en">
							<p>We hope the AI question feature on this site can serve as a friendly, open, and sustainable public knowledge gateway where people can ask, share, and learn with confidence.</p>
							<p>We do not sell or exchange your personal data, and do not build an advertising profile of you.</p>
							<p>When you ask a question in the search box, we collect and retain the questions you submit to generate replies, maintain service quality, detect abuse, and handle security incidents.</p>
							<p>To keep the service stable and fair for everyone, and to prevent abuse, attacks, rate-limit bypasses, or large-scale automated requests, we also collect and retain necessary anti-abuse information, including connection IP addresses, website user IDs (if available), request times, rate-limit records, and related technical logs.</p>
							<p>This information is used only to provide the service, maintain service security, detect abnormal traffic, create or enforce anti-abuse lists, handle security incidents, and comply with legal or regulatory requirements. It is not used for advertising and is not sold to third parties. Unless we identify suspected abuse, attacks, rate-limit circumvention, or other improper use, or are legally required to do so, we do not provide your question content or identifiable information to third parties.</p>
							<p>The service may receive request information required by its hosting infrastructure to operate. Except as needed to provide the service, maintain security, prevent abuse, or comply with law, we do not otherwise actively collect or retain personal data that identifies you.</p>
							<p><em>This English version is provided for convenience; if it and the Chinese version differ, the Chinese version governs.</em></p>
						</div>
					</section>
					<nav class="legal-page__nav" aria-label="Legal pages">
						<a href="/"><span lang="zh">首頁</span><span lang="en">Home</span></a>
						<a href="/terms"><span lang="zh">使用條款</span><span lang="en">Terms of Use</span></a>
					</nav>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.legal-page {
	max-width: 760px;
	padding: 2rem 0 3rem;
	line-height: 1.7;
}
.legal-page h1 {
	margin: 0 0 1.5rem;
	font-size: clamp(1.75rem, 4vw, 2.5rem);
}
.legal-page__section h2 {
	margin: 2rem 0 0.75rem;
	font-size: 1.25rem;
}
.legal-page__section p {
	margin: 0 0 1rem;
}
.legal-page__section--alt {
	padding-top: 1.75rem;
	border-top: 1px solid rgba(0, 0, 0, 0.12);
}
.legal-page__nav {
	margin-top: 2rem;
	display: flex;
	flex-wrap: wrap;
	gap: 1rem;
}
@media (prefers-color-scheme: dark) {
	.legal-page__section--alt {
		border-color: rgba(255, 255, 255, 0.15);
	}
}
</style>