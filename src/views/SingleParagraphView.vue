<script setup lang="ts">
import { computed } from 'vue'
import { getSpeakerColor } from '../utils/speakerColor'
import { parseContent, renderSpeechHtml, toPlainText } from '../utils/textUtils'

type Section = {
	filename: string;
	section_id: number;
	section_speaker: string | null;
	section_content: string;
	previous_section_id: number | null;
	next_section_id: number | null;
	display_name: string;
	photoURL: string | null;
	name: string | null;
	previous_content: string | null;
	next_content: string | null;
};

const props = defineProps<{ section: Section }>();

const speakerColor = getSpeakerColor(
	props.section?.section_speaker ||
	props.section?.name ||
	props.section?.filename ||
	''
);
const avatarStyle = { borderColor: speakerColor, backgroundColor: speakerColor };



const parsedContent = renderSpeechHtml(props.section?.section_content);
const previousTextPreview = props.section?.previous_content
	? toPlainText(parseContent(props.section.previous_content)).slice(0, 30)
	: '';
const nextTextPreview = props.section?.next_content
	? toPlainText(parseContent(props.section.next_content)).slice(0, 30)
	: '';
const recordLanguage = computed(() =>
	/[\u3400-\u9fff]/u.test(toPlainText(parsedContent)) ? 'zh-Hant' : 'en'
)

const getSpeakerUrl = (route_pathname: string | null) => (route_pathname ? `/speaker/${route_pathname}` : '#');
const getSpeechUrl = (filename: string) => `/${encodeURIComponent(filename)}`;
const getContextUrl = (filename: string, sectionId: number) => `/${encodeURIComponent(filename)}#s${sectionId}`;
const getParagraphUrl = (sectionId: number) => `/speech/${sectionId}`;
</script>

<template>
	<div class="page">
		<Navbar />
		<main id="main-content">
			<div class="sayit-ask-overlay">
				<div id="sayit-ask-answer" class="homepage-ask-answer" aria-live="polite" hidden></div>
			</div>
			<div id="sayit-search-results" class="sayit-search__results" aria-live="polite" hidden></div>
			<div class="full-page" v-if="section">
				<div class="full-page__row">
					<div class="full-page__unit">
						<div class="single-speech-layout">
							<article class="speech speech-single-speech" aria-labelledby="page-title" :style="{ '--speaker-color': speakerColor }">
								<a
									v-if="section.section_speaker"
									class="speech-single-speech__speaker-portrait"
									:href="getSpeakerUrl(section.section_speaker)"
								>
									<img
										:src="section.photoURL || '/static/speeches/i/a.png'"
										:style="avatarStyle"
										:alt="section.name || ''"
										class="speaker-portrait speaker-portrait--large"
									>
								</a>
								<header class="speech__meta-data">
									<p class="homepage-search__kicker">
										<span lang="zh">可引用的發言段落</span><span lang="en">Citable transcript turn</span>
									</p>
									<h1 id="page-title" :class="{ 'jf-lanyanghei-heavy': recordLanguage === 'zh-Hant' }">#{{ section.section_id }}</h1>
									<p v-if="section.section_speaker && section.name">
										<span lang="zh">講者：</span><span lang="en">Speaker: </span>
										<span class="speech__meta-data__speaker-name">
											<a :href="getSpeakerUrl(section.section_speaker)">{{ section.name }}</a>
										</span>
									</p>
								</header>
								<div
									:class="['speech__content speech__content-single-speech record-copy', recordLanguage === 'zh-Hant' ? 'jf-lanyangming-light' : '']"
									:lang="recordLanguage"
									v-html="parsedContent"
								></div>
								<nav class="speech__links" aria-labelledby="turn-actions-label">
									<span id="turn-actions-label" class="visually-hidden"><span lang="zh">逐字稿導覽</span><span lang="en">Transcript navigation</span></span>
									<a :href="getContextUrl(section.filename, section.section_id)">
									<span lang="zh">查看前後文</span><span lang="en">View context</span>
									</a>
									<button
										type="button"
										class="button button--secondary"
										data-sayit-share
										:data-share-url="getContextUrl(section.filename, section.section_id)"
										:data-share-title="section.display_name"
									>
									<span lang="zh">分享此段</span><span lang="en">Share turn</span>
									</button>
								</nav>
								<nav class="breadcrumbs" v-if="section.filename" aria-labelledby="source-record-label">
									<span id="source-record-label" class="visually-hidden"><span lang="zh">來源逐字稿</span><span lang="en">Source record</span></span>
									<a :href="getSpeechUrl(section.filename)">{{ section.display_name }}</a>
								</nav>
							</article>
							<nav class="speech-navigation" aria-labelledby="adjacent-turns-label">
								<span id="adjacent-turns-label" class="visually-hidden"><span lang="zh">相鄰段落</span><span lang="en">Adjacent turns</span></span>
								<a
									v-if="section.previous_section_id"
									:href="getParagraphUrl(section.previous_section_id)"
									class="button speech-navigation__button"
								>
									<template v-if="previousTextPreview">← {{ previousTextPreview }}…</template>
									<template v-else>← <span lang="zh">上一段</span><span lang="en">Previous turn</span></template>
								</a>
								<a
									v-if="section.next_section_id"
									:href="getParagraphUrl(section.next_section_id)"
									class="button speech-navigation__button"
								>
									<template v-if="nextTextPreview">{{ nextTextPreview }}… →</template>
									<template v-else><span lang="zh">下一段</span><span lang="en">Next turn</span> →</template>
								</a>
							</nav>
							<div
								class="ui-instructions"
								id="keyboard-shortcuts"
								:data-prev-url="section.previous_section_id ? getParagraphUrl(section.previous_section_id) : ''"
								:data-next-url="section.next_section_id ? getParagraphUrl(section.next_section_id) : ''"
							>
								<h2><span lang="zh">鍵盤快捷鍵</span><span lang="en">Keyboard shortcuts</span></h2>
								<p>
									<span class="key-descriptor">j</span> <span lang="zh">下一段</span><span lang="en">next turn</span>
									<span class="key-descriptor">k</span> <span lang="zh">上一段</span><span lang="en">previous turn</span>
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>
		<Footer />
	</div>
</template>


