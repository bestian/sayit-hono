<script setup lang="ts">

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

function parseContent(raw?: string | null) {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'string' ? parsed : raw;
	} catch {
		return raw;
	}
}

function stripHtmlTags(html: string): string {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const parsedContent = parseContent(props.section?.section_content);
const previousTextPreview = props.section?.previous_content
	? stripHtmlTags(parseContent(props.section.previous_content)).slice(0, 30)
	: '';
const nextTextPreview = props.section?.next_content
	? stripHtmlTags(parseContent(props.section.next_content)).slice(0, 30)
	: '';

const getSpeakerUrl = (route_pathname: string | null) => (route_pathname ? `/speaker/${route_pathname}` : '#');
const getSpeechUrl = (filename: string) => `/${encodeURIComponent(filename)}`;
const getContextUrl = (filename: string, sectionId: number) => `/${encodeURIComponent(filename)}#s${sectionId}`;
const getParagraphUrl = (sectionId: number) => `/speech/${sectionId}`;
</script>

<template>
	<div class="page">
		<Navbar />
		<div class="full-page" v-if="section">
			<div class="full-page__row">
				<div class="full-page__unit">
					<div class="single-speech-layout">
						<div class="single-speech-layout__speech-column">
							<div class="speech speech-single-speech">
								<a
									v-if="section.section_speaker && section.photoURL"
									class="speech-single-speech__speaker-portrait"
									:href="getSpeakerUrl(section.section_speaker)"
								>
									<img
										:src="'https://sayit.archive.tw' + section.photoURL"
										:style="`border-color: #4d89d2; background-color: #4d89d2;`"
										:alt="section.name || ''"
										class="speaker-portrait speaker-portrait--left round-image speaker-portrait--large"
									/>
								</a>
								<div class="speech__meta-data">
									<span class="speech__meta-data__speech-type">Speech</span>
									<span v-if="section.section_speaker && section.name">
										by
										<span class="speech__meta-data__speaker-name">
											<a :href="getSpeakerUrl(section.section_speaker)">{{ section.name }}</a>
										</span>
									</span>
								</div>
								<div class="speech__content speech__content-single-speech" v-html="parsedContent"></div>
								<ul class="breadcrumbs" v-if="section.filename">
									<li>
										<a :href="getSpeechUrl(section.filename)">
											{{ section.display_name }}
										</a>
									</li>
								</ul>
								<div class="speech__links" v-if="section.filename && section.section_id">
									<a :href="getContextUrl(section.filename, section.section_id)">
										<i class="speech-icon icon-link-in-context"></i>Show context
									</a>
								</div>
							</div>
							<div class="speech-navigation">
								<div class="speech-navigation__column speech-navigation__column--one">
									<a
										v-if="section.previous_section_id"
										:href="getParagraphUrl(section.previous_section_id)"
										class="button speech-navigation__button"
									>
										<template v-if="previousTextPreview">
											← {{ previousTextPreview }}...
										</template>
										<template v-else>
											← （...
										</template>
									</a>
									<a
										v-if="section.next_section_id"
										:href="getParagraphUrl(section.next_section_id)"
										class="button speech-navigation__button"
									>
										<template v-if="nextTextPreview">
											{{ nextTextPreview }}... →
										</template>
										<template v-else>
											（... →
										</template>
									</a>
								</div>
								<div class="speech-navigation__column speech-navigation__column--two">
									<div class="ui-instructions">
										<h2>Keyboard shortcuts</h2>
										<p>
											<span class="key-descriptor">j</span> previous speech
											<span class="key-descriptor">k</span> next speech
										</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<Footer />
	</div>
</template>


