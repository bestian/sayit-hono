<template>
	<div class="page">
		<Navbar :show-search="false" />
		<main id="main-content" class="full-page">
			<section class="full-page__row">
				<div class="full-page__unit homepage-hero">
					<div class="homepage-search">
						<p class="homepage-search__kicker">
							<span lang="zh">公開發言紀錄</span><span lang="en">Public speech archive</span>
						</p>
						<h1><span lang="zh">找到那句原話。</span><span lang="en">Find the exact words.</span></h1>
						<p class="homepage-search__lede">
							<span lang="zh">搜尋誰在何時說了什麼，沿著前後文閱讀，並回到可引用的發言段落。</span>
							<span lang="en">Search what was said, follow the exchange, and return to a turn you can cite.</span>
						</p>
						<label class="homepage-search__label" for="sayit-search-input">
							<span lang="zh">搜尋原話、講者或對話</span><span lang="en">Search exact words, speakers, or sections</span>
						</label>
						<div class="homepage-search__row">
							<form id="sayit-search" class="sayit-search sayit-search--homepage" role="search" action="/search/" method="get">
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
											placeholder="Try a phrase or speaker’s name…"
										>
										<span class="sayit-search__shortcut" id="sayit-search-shortcut" aria-hidden="true">/</span>
									</div>
									<button type="submit" class="sayit-search__submit">
										<span lang="zh">搜尋</span><span lang="en">Search</span>
									</button>
								</div>
							</form>
							<button type="button" id="sayit-ask-submit" class="homepage-ask__submit" hidden aria-hidden="true">
								<span lang="zh">向典藏提問</span><span lang="en">Ask archive</span>
							</button>
						</div>
						<p class="homepage-search__mode-note">
							<span lang="zh">搜尋會回傳原文；AI 提問會另外顯示附有來源的綜整。</span>
							<span lang="en">Search returns the record. Ask archive creates a separate synthesis with sources.</span>
						</p>
						<div id="sayit-ask" class="homepage-ask" hidden>
							<p id="sayit-ask-status" class="homepage-ask__status" aria-live="polite"></p>
						</div>
					</div>
					<aside class="homepage-browse" aria-labelledby="homepage-browse-title">
						<h2 id="homepage-browse-title">
							<span lang="zh">從典藏開始</span><span lang="en">Browse the archive</span>
						</h2>
						<ul>
							<li>
								<a href="/speeches/">
									<strong><span lang="zh">對話紀錄</span><span lang="en">Recorded conversations</span></strong>
									<span><span lang="zh">依日期閱讀完整紀錄</span><span lang="en">Read complete records by date</span></span>
								</a>
							</li>
							<li>
								<a href="/speakers/">
									<strong><span lang="zh">講者索引</span><span lang="en">Speaker index</span></strong>
									<span><span lang="zh">尋找典藏中的具名聲音</span><span lang="en">Find every named voice</span></span>
								</a>
							</li>
							<li>
								<a href="/rss.xml">
									<strong><span lang="zh">最新紀錄</span><span lang="en">Archive feed</span></strong>
									<span><span lang="zh">透過 RSS 接收更新</span><span lang="en">Follow new records through RSS</span></span>
								</a>
							</li>
						</ul>
					</aside>
				</div>
			</section>
			<div id="sayit-ask-answer" class="homepage-ask-answer" aria-live="polite" hidden></div>
			<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden></div>
			<div class="homepage-stats" id="sayit-stats">
				<div class="full-page__row">
					<div class="full-page__unit">
						<a href="/speeches/"><strong id="sayit-stat-speeches">406,288</strong></a>
						<span lang="zh"> 段發言</span><span lang="en"> turns</span>
						<span aria-hidden="true"> · </span>
						<a href="/speakers/"><strong id="sayit-stat-speakers">8,231</strong></a>
						<span lang="zh"> 位講者</span><span lang="en"> speakers</span>
						<span aria-hidden="true"> · </span>
						<a href="/speeches/"><strong id="sayit-stat-sections">2,089</strong></a>
						<span lang="zh"> 場對話</span><span lang="en"> sections</span>
					</div>
				</div>
			</div>
		</main>
		<Footer />
	</div>
</template>
