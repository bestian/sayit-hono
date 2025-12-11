<script setup lang="ts">
import { computed } from 'vue'
import { headForSpeakers } from '../ssr/heads'

interface Speaker {
  id: number,
  route_pathname: string,
  name: string,
  photoURL: string | null
}

const props = defineProps<{ speakers?: Speaker[] }>()
const speakers = computed<Speaker[]>(() => props.speakers ?? [])

</script>

<template>
	<div class="page">
		<Navbar />
		<div class="full-page">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="page-header">
						<h1>All Speakers</h1>
					</div>
					<ul class="speaker-list">
						<li v-for="speaker in speakers" :key="speaker.id">
							<a :href="'/speaker/' + speaker.route_pathname">
								<div class="speaker-card">
									<img :src="speaker.photoURL ? 'https://sayit.archive.tw' + speaker.photoURL : '/static/speeches/i/a.png'"
										style="border-color: #9c4f2d; background-color: #9c4f2d;" :alt="speaker.name || 'Speaker Photo'"
										class="speaker-card__portrait speaker-portrait round-image speaker-portrait--small">
									<span class="speaker-card__name"> {{ speaker.name || 'Speaker' }}</span>
								</div>
							</a>
						</li>
					</ul>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>
