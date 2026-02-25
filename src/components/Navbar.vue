<template>
	<header class="full-page__row navbar">
		<div class="full-page__unit">
			<ul class="inline-list left">
				<li>
					<a href="/"><span lang="zh">首頁</span><span lang="en">Home</span></a>
				</li>
				<li>
					<a href="/speakers"><span lang="zh">講者</span><span lang="en">Speakers</span></a>
				</li>
				<li>
					<a href="/speeches"><span lang="zh">對話</span><span lang="en">Speeches</span></a>
				</li>
			</ul>
			<div class="navbar__right"><slot /></div>
		</div>
	</header>
</template>

<style>
/* Navbar layout for search slot */
.navbar .full-page__unit {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
}

.navbar__right {
	margin-left: auto;
	flex-shrink: 1;
	min-width: 0;
}

/* Search widget styles (shared across all pages with search) */
.sayit-search {
	width: 220px;
	margin: 0;
}

@media (max-width: 580px) {
	.sayit-search {
		width: 100%;
		margin-top: 0.4em;
	}
}

.sayit-search__input-wrap {
	position: relative;
	max-width: 100%;
}

.sayit-search__input {
	display: block;
	width: 100%;
	padding: 0.45em 0.8em;
	padding-right: 2.4em;
	font-family: 'Noto Sans TC', sans-serif;
	font-size: 0.9em;
	font-weight: 400;
	line-height: 1.5;
	color: #2c2c2c;
	background: #fafaf8;
	border: 1.5px solid #d4d0c8;
	border-radius: 6px;
	outline: none;
	transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
	box-sizing: border-box;
	-webkit-appearance: none;
}

.sayit-search__input::placeholder {
	color: #9e998e;
	font-weight: 300;
}

.sayit-search__input:focus {
	border-color: #8b7e6a;
	background: #fff;
	box-shadow: 0 0 0 3px rgba(139, 126, 106, 0.1);
}

.sayit-search__input::-webkit-search-decoration,
.sayit-search__input::-webkit-search-cancel-button {
	-webkit-appearance: none;
}

.sayit-search__shortcut {
	position: absolute;
	right: 0.8em;
	top: 50%;
	transform: translateY(-50%);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.6em;
	height: 1.6em;
	font-family: monospace, 'Noto Sans TC', sans-serif;
	font-size: 0.8em;
	font-weight: 500;
	color: #a09888;
	background: #eeedea;
	border: 1px solid #d8d4cc;
	border-radius: 4px;
	pointer-events: none;
	transition: opacity 0.25s ease;
}

@media (hover: none) {
	.sayit-search__shortcut {
		display: none;
	}
}

.sayit-search__results {
	margin-top: 0.4em;
	overflow: hidden;
}

.sayit-search__results[hidden] {
	display: none;
}

.sayit-search__results-inner {
	animation: sayit-fade-in 0.2s ease;
}

.sayit-search__status {
	padding: 0.7em 0;
	font-size: 0.85em;
	color: #9e998e;
	font-weight: 300;
	letter-spacing: 0.01em;
}

.sayit-search__result {
	display: block;
	padding: 0.85em 0.5em;
	margin: 0 -0.5em;
	border-bottom: 1px solid #eeedea;
	text-decoration: none;
	color: inherit;
	border-radius: 4px;
	transition: background 0.15s ease;
}

.sayit-search__result:last-of-type {
	border-bottom: none;
}

.sayit-search__result:hover {
	background: #f5f4f0;
}

.sayit-search__result-title {
	font-size: 1em;
	font-weight: 500;
	color: #2c2c2c;
	line-height: 1.45;
	margin: 0;
	word-break: break-word;
}

.sayit-search__result:hover .sayit-search__result-title {
	color: #3a7d5c;
}

.sayit-search__result-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5em;
	margin-top: 0.2em;
	font-size: 0.8em;
	color: #a09888;
	font-weight: 400;
}

.sayit-search__result-excerpt {
	margin-top: 0.3em;
	font-size: 0.88em;
	line-height: 1.65;
	color: #5a5650;
	font-weight: 400;
	word-break: break-word;
	overflow-wrap: break-word;
}

.sayit-search__result-excerpt mark {
	background: rgba(201, 180, 120, 0.3);
	color: inherit;
	padding: 0.05em 0.15em;
	border-radius: 2px;
	font-weight: 500;
}

.sayit-search__loading {
	display: flex;
	align-items: center;
	gap: 0.6em;
	padding: 0.8em 0;
	font-size: 0.85em;
	color: #9e998e;
	font-weight: 300;
}

.sayit-search__spinner {
	width: 0.9em;
	height: 0.9em;
	border: 1.5px solid #e0ddd6;
	border-top-color: #8b7e6a;
	border-radius: 50%;
	animation: sayit-spin 0.6s linear infinite;
}

button.sayit-search__more {
	/* Reset Foundation button styles */
	display: block;
	width: 100%;
	margin: 1em 0 0.25em;
	padding: 0.7em 1.5em;
	font-family: 'Noto Sans TC', sans-serif;
	font-size: 0.85em;
	font-weight: 400;
	letter-spacing: 0.02em;
	color: #6b6357;
	background: transparent;
	border: 1.5px solid #d4d0c8;
	border-radius: 6px;
	cursor: pointer;
	text-align: center;
	text-decoration: none;
	transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
	-webkit-appearance: none;
	appearance: none;
}

button.sayit-search__more:hover,
button.sayit-search__more:focus {
	color: #3a7d5c;
	border-color: #3a7d5c;
	background: rgba(58, 125, 92, 0.04);
	text-decoration: none;
}

button.sayit-search__more:active {
	background: rgba(58, 125, 92, 0.08);
}

@keyframes sayit-spin {
	to { transform: rotate(360deg); }
}

@keyframes sayit-fade-in {
	from { opacity: 0; transform: translateY(-4px); }
	to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 640px) {
	.sayit-search__input {
		font-size: 16px;
	}
}
</style>
