<script setup lang="ts">
import { getSpeakerColor } from '../utils/speakerColor'

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

function sanitizeHtmlContent(html: string): string {
	// Remove script tags with various formats and replace with warning comment
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '<!-- Warning: there\'s an unexpected Script -->')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<!-- Warning: there\'s an unexpected Script -->')
		.replace(/<script[^>]*\/>/gi, '<!-- Warning: there\'s an unexpected Script -->');
}

const parsedContent = sanitizeHtmlContent(parseContent(props.section?.section_content));
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
									v-if="section.section_speaker"
									class="speech-single-speech__speaker-portrait"
									:href="getSpeakerUrl(section.section_speaker)"
								>
									<img
										:src="section.photoURL || '/static/speeches/i/a.png'"
										:style="avatarStyle"
										:alt="section.name || ''"
										class="speaker-portrait speaker-portrait--left round-image speaker-portrait--large"
									/>
								</a>
								<div class="speech__meta-data">
									<span class="speech__meta-data__speech-type"><span lang="zh">發言</span><span lang="en">Speech</span></span>
									<span v-if="section.section_speaker && section.name">
										<span lang="en">by</span>
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
										<i class="speech-icon icon-link-in-context"></i><span lang="zh">顯示前後文</span><span lang="en">Show context</span>
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
									<div
										class="ui-instructions"
										id="keyboard-shortcuts"
										:data-prev-url="section.previous_section_id ? getParagraphUrl(section.previous_section_id) : ''"
										:data-next-url="section.next_section_id ? getParagraphUrl(section.next_section_id) : ''"
									>
										<h2><span lang="zh">鍵盤快捷鍵</span><span lang="en">Keyboard shortcuts</span></h2>
										<p>
											<span class="key-descriptor">j</span> <span lang="zh">下一段</span><span lang="en">next speech</span>
											<span class="key-descriptor">k</span> <span lang="zh">上一段</span><span lang="en">previous speech</span>
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


