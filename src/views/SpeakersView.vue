<script setup lang="ts">
import { computed } from 'vue'
import { getSpeakerColor } from '../utils/speakerColor'

interface Speaker {
  id: number,
  route_pathname: string,
  name: string,
  photoURL: string | null
}

const props = defineProps<{ speakers?: Speaker[] }>()
const speakers = computed<Speaker[]>(() => props.speakers ?? [])

const colorStyle = (route: string, name?: string) => {
	const color = getSpeakerColor(route || name || '')
	return { borderColor: color, backgroundColor: color }
}

</script>

<template>
	<div class="page">
		<Navbar />
		<main id="main-content" class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="page-header">
						<h1><span lang="zh">講者索引</span><span lang="en">Speaker index</span></h1>
					</div>
					<form class="site-search site-search--on-results-page" action="/search/" method="get">
						<label for="site-search-input" class="visually-hidden"><span lang="zh">搜尋講者</span><span lang="en">Search speakers</span></label>
						<div class="search-wrapper">
							<input type="search" id="site-search-input" class="site-search__input" placeholder="Search speakers or exact words" name="q" />
							<button type="submit" class="site-search__submit"><span lang="zh">搜尋</span><span lang="en">Search</span></button>
						</div>
					</form>
					<ul class="speaker-list">
						<li v-for="speaker in speakers" :key="speaker.id">
							<a :href="'/speaker/' + speaker.route_pathname">
								<div class="speaker-card">
									<img :src="speaker.photoURL || '/static/speeches/i/a.png'"
										:style="colorStyle(speaker.route_pathname, speaker.name)"
										alt=""
										loading="lazy" decoding="async"
										class="speaker-card__portrait speaker-portrait round-image speaker-portrait--small">
									<span class="speaker-card__name"> {{ speaker.name || 'Speaker' }}</span>
								</div>
							</a>
						</li>
					</ul>
				</div>
			</div>
		</main>
		<Footer />
	</div>
</template>
