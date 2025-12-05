<template>
	<div class="page">
		<Navbar />
		<main class="page__content">
			<h1>About</h1>
			<p>這個頁面示範第二個獨立 Vue SFC，沒有使用 router 或 App.vue。</p>
		</main>
		<Footer />
	</div>
</template>

<style>
.page {
	min-height: 100vh;
	margin: 0;
	display: grid;
	gap: 24px;
	background: radial-gradient(circle at 20% 20%, #fff7ed, #e0f2fe);
	font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	color: #111827;
}

.page__content {
	padding: 64px 24px;
	display: grid;
	gap: 16px;
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

