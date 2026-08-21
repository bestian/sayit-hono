<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status?: number }>()

const COPY = {
	400: {
		titleZh: '無效的網址',
		titleEn: 'Invalid address',
		messageZh: '請確認連結格式是否正確。',
		messageEn: 'Please check that the link is well-formed.',
	},
	404: {
		titleZh: '找不到這一頁',
		titleEn: 'Page not found',
		messageZh: '這段紀錄可能已移動，或網址有誤。',
		messageEn: 'The record may have moved, or the address is wrong.',
	},
} as const

const status = computed(() => (props.status === 400 ? 400 : 404))
const copy = computed(() => COPY[status.value])
</script>

<template>
	<div class="page">
		<Navbar />
		<main id="main-content" class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit error-page">
					<p class="error-page__code">{{ status }}</p>
					<h1><span lang="zh">{{ copy.titleZh }}</span><span lang="en">{{ copy.titleEn }}</span></h1>
					<p class="error-page__message"><span lang="zh">{{ copy.messageZh }}</span><span lang="en">{{ copy.messageEn }}</span></p>
					<p class="error-page__home">
						<a href="/"><span lang="zh">回到首頁</span><span lang="en">Back to the archive</span></a>
					</p>
				</div>
			</div>
		</main>
		<Footer />
	</div>
</template>

<style>
/* Non-scoped on purpose: vite-plugin-sfc-ssr never attaches __scopeId, so scoped
   selectors would never match in SSR. Class names are unique to this view. */
.error-page {
	width: min(100%, 54rem);
	padding-block: var(--space-7);
}

.error-page__code {
	margin: 0;
	color: var(--slate);
	font-family: var(--font-decisive);
	font-variant-numeric: tabular-nums;
	font-weight: 700;
	letter-spacing: 0.08em;
}

.error-page h1 {
	max-inline-size: min(24ch, 100%);
	margin-block: var(--space-3) var(--space-4);
	font-size: clamp(1.75rem, 1.5rem + 1vw, 2.5rem);
	line-height: 1.15;
}

.error-page__message {
	max-inline-size: var(--reading-zh);
	margin: 0;
	color: var(--slate);
	font-size: 1.0625rem;
	line-height: 1.7;
}

.error-page__home {
	margin-block-start: var(--space-6);
}

/* 44px tap target on an inline link: pad the anchor, pull the layout back */
.error-page__home a {
	display: inline-block;
	padding-block: 0.55rem;
	margin-block: -0.55rem;
	font-weight: 650;
}

@media (pointer: coarse) {
	.error-page__home a:active {
		background: var(--index-wash);
		color: var(--index-strong);
	}
}
</style>
