<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
			<div class="full-page__unit">
				<div class="page-content__row">
					<div class="homepage-search">
						<h2>Search speeches and statements</h2>
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
				<a href="/speeches"><strong>400841</strong></a> speeches;
				<a href="/speakers"><strong>8037</strong></a> speakers;
				<a href="/speeches"><strong>2193</strong></a> sections
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

<style scoped>
</style>

