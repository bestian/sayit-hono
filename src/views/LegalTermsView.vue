<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit legal-page">
					<h1><span lang="zh">使用條款</span><span lang="en">Terms of Use</span></h1>
					<section class="legal-page__section" aria-labelledby="terms-zh">
						<h2 id="terms-zh"><span lang="zh">華語</span></h2>
						<div lang="zh">
							<p>我們歡迎您以好奇、善意與負責任的方式使用本站的 AI 提問與搜尋功能，探索唐鳳的公開談話、引用有出處的內容，並與更多人分享公共知識。</p>
							<p>使用本服務前，請先閱讀並同意本使用條款與 <a href="/privacy">隱私權政策</a>。若您不同意，請勿使用本服務。</p>
							<p>為維護服務穩定、提供回覆、避免濫用、攻擊、繞過限流或大量自動化請求，您同意我們依隱私權政策收集並使用必要資訊，包括您提出的問題、連線 IP、網站使用者識別碼（如有）、請求時間、限流紀錄與相關技術紀錄。除非發現濫用疑慮或依法必須提供，否則我們不會將您的提問內容或可識別資訊提供給第三方。</p>
							<p>您不得以自動化、偽造身分、變更來源、分散流量或其他方式規避限流、封鎖或安全措施；如有濫用、攻擊或不當使用情事，我們得暫停、限制或封鎖相關請求，並保留法律追訴權。</p>
							<p>AI 回應之內容採用 Creative Commons Attribution-ShareAlike（CC BY-SA，姓名標示-相同方式分享）授權。</p>
							<p>您可以在合理使用及註明出處後引用、分享、改作或進行衍生創作；衍生內容亦應依 CC BY-SA 的精神，以相同或相容授權方式分享。</p>
							<p>上述授權不包含惡意的斷章取義、變造文句、截圖加工，或其他足以誤導他人、損害原意或侵害權益的使用方式。</p>
							<p>如有惡意使用、誤導性使用或其他不當使用情事，我們保留法律追訴權。</p>
						</div>
					</section>
					<section class="legal-page__section legal-page__section--alt" aria-labelledby="terms-en">
						<h2 id="terms-en"><span lang="en">English</span></h2>
						<div lang="en">
							<p>We welcome you to use this site’s AI question and search features with curiosity, goodwill, and responsibility: explore Audrey Tang's public talks, cite sourced content, and share public knowledge with others.</p>
							<p>Before using this service, please read and agree to these Terms of Use and the <a href="/privacy">Privacy Policy</a>. If you do not agree, please do not use the service.</p>
							<p>To maintain service stability, provide replies, and prevent abuse, attacks, rate-limit bypasses, or large-scale automated requests, you agree that we may collect and use necessary information as described in the Privacy Policy, including the questions you submit, connection IP addresses, website user IDs (if available), request times, rate-limit records, and related technical logs. Unless we identify suspected abuse or are legally required to do so, we do not provide your question content or identifiable information to third parties.</p>
							<p>You may not use automation, forged identities, changed origins, distributed traffic, or other methods to circumvent rate limits, blocks, or security measures. In cases of abuse, attacks, or improper use, we may suspend, restrict, or block related requests and reserve the right to pursue legal action.</p>
							<p>Content provided in AI replies is licensed under Creative Commons Attribution-ShareAlike (CC BY-SA).</p>
							<p>You may quote, share, adapt, or create derivative works from the content after making reasonable use and providing proper attribution. Derivative works should also be shared under the same or a compatible license in the spirit of CC BY-SA.</p>
							<p>This permission does not include malicious quotation out of context, alteration of wording, edited screenshots, or any other use that may mislead others, distort the original meaning, or infringe rights.</p>
							<p>We reserve the right to pursue legal action in cases of malicious, misleading, or otherwise improper use.</p>
							<p><em>This English version is provided for convenience; if it and the Chinese version differ, the Chinese version governs.</em></p>
						</div>
					</section>
					<nav class="legal-page__nav" aria-label="Legal pages">
						<a href="/"><span lang="zh">首頁</span><span lang="en">Home</span></a>
						<a href="/privacy"><span lang="zh">隱私權政策</span><span lang="en">Privacy Policy</span></a>
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