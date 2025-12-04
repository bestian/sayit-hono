<template>
	<main class="page">
		<h1>Home</h1>
		<p>這是首頁，使用 Vue SSR 直接由 Worker 輸出。</p>
		<a href="/about">Learn more</a>
	</main>
</template>

<style>
.page {
	min-height: 100vh;
	margin: 0;
	padding: 64px 24px;
	display: grid;
	gap: 16px;
	place-content: start;
	background: linear-gradient(135deg, #f5f7fa, #e0e7ff);
	font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	color: #1f2937;
}

h1 {
	margin: 0;
	font-size: 2.25rem;
}

p {
	margin: 0;
	max-width: 540px;
	line-height: 1.6;
}
</style>

