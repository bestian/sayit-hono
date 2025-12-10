import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderHtml } from '../src/ssr/render';
import type { Component } from 'vue';
import { buildViews } from './build-views';
import {
	headForHome,
	headForSingleSpeech,
	headForSpeeches,
	headForSpeakers,
	headForSpeaker
} from '../src/ssr/heads';

type PageSpec = {
	filename: string;
	title?: string;
	head?: import('../src/ssr/heads').HeadSpec;
	styles?: string;
	component: Component;
	components: Record<string, Component>;
	aliases?: string[];
	props?: Record<string, unknown>;
	scripts?: string;
};

type Section = {
	filename: string;
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
	display_name: string;
	photoURL: string | null;
	name: string | null;
};

type SpeakerDetail = {
	id: number;
	route_pathname: string;
	name: string;
	photoURL: string | null;
	appearances_count: number;
	sections_count: number;
	sections: Section[];
	longest_section: {
		section_id: number;
		section_content: string;
		section_filename: string;
		section_display_name: string;
	} | null;
};

function mergeStyles(...styles: Array<string | undefined>) {
	return styles.filter(Boolean).join('\n');
}

async function loadCompiledEntries() {
	await buildViews();
	const [views, components] = await Promise.all([
		import(pathToFileURL(path.resolve('src/.generated/views/index.ts')).href),
		import(pathToFileURL(path.resolve('src/.generated/components/index.ts')).href)
	]);

	return { views, components };
}

function checkMonotonic(sections: Section[]): boolean {
	if (sections.length <= 1) return true;
	for (let i = 1; i < sections.length; i++) {
		const current = sections[i];
		const previous = sections[i - 1];
		if (current && previous && current.section_id <= previous.section_id) {
			return false;
		}
	}
	return true;
}

function reorderSections(sections: Section[]): Section[] {
	if (sections.length === 0) return [];

	const newArray: Section[] = [];
	const remaining = [...sections];

	let minIndex = 0;
	let minSectionId = remaining[0]?.section_id ?? 0;
	for (let i = 1; i < remaining.length; i++) {
		const current = remaining[i];
		if (current && current.section_id < minSectionId) {
			minSectionId = current.section_id;
			minIndex = i;
		}
	}

	const firstSection = remaining[minIndex];
	if (firstSection) {
		newArray.push(firstSection);
		remaining.splice(minIndex, 1);
	}

	const arrayLength = sections.length;
	for (let i = 0; i < arrayLength - 1; i++) {
		const lastItem = newArray[newArray.length - 1];
		if (!lastItem) break;

		const lastSectionId = lastItem.section_id;
		let found = false;

		for (let j = 0; j < remaining.length; j++) {
			const current = remaining[j];
			if (current && current.previous_section_id === lastSectionId) {
				newArray.push(current);
				remaining.splice(j, 1);
				found = true;
				break;
			}
		}

		if (!found) break;
	}

	return newArray;
}

async function fetchSpeechSections(speechName: string) {
	const apiBase =
		process.env.SPEECH_API_BASE ?? 'https://sayit-hono.audreyt.workers.dev/api/speech/';
	const target = `${apiBase}${encodeURIComponent(speechName)}`;

	const res = await fetch(target);
	if (!res.ok) {
		throw new Error(`fetch speech ${speechName} failed: ${res.status}`);
	}

	return (await res.json()) as Section[];
}

async function fetchSpeakerDetail(routePathname: string) {
	const apiBase =
		process.env.SPEAKER_DETAIL_BASE ?? 'https://sayit-hono.audreyt.workers.dev/api/speaker_detail/';
	const normalizedPathname = routePathname.endsWith('.json') ? routePathname : `${routePathname}.json`;
	const target = `${apiBase}${normalizedPathname}`;

	const res = await fetch(target);
	if (!res.ok) {
		throw new Error(`fetch speaker detail ${routePathname} failed: ${res.status}`);
	}

	const data = (await res.json()) as SpeakerDetail;
	const normalizedSections = normalizeSections(data.sections ?? []).map((section) => ({
		...section,
		photoURL: section.photoURL ?? null,
		name: section.name ?? null
	}));
	return { ...data, sections: normalizedSections };
}

function normalizeSections(rawData: Section[]): Section[] {
	return checkMonotonic(rawData) ? rawData : reorderSections(rawData);
}

async function renderPage({
	component,
	title,
	styles,
	filename,
	components,
	aliases,
	props,
	head,
	scripts
}: PageSpec) {
	const html = await renderHtml(component, { title, styles, components, props, head, scripts });

	const outDir = path.resolve('www');
	await mkdir(outDir, { recursive: true });

	const targets = [filename, ...(aliases ?? [])];
	for (const target of targets) {
		const fullPath = path.join(outDir, target);
		await mkdir(path.dirname(fullPath), { recursive: true });
		await writeFile(fullPath, html, 'utf8');
	}
}

async function prerender() {
	const { views, components } = await loadCompiledEntries();
	const sharedComponents = { Navbar: components.Navbar, Footer: components.Footer };
	const sharedStyles = mergeStyles(components.NavbarStyles, components.FooterStyles);

	const speechIndexUrl =
		process.env.SPEECH_INDEX_URL ?? 'https://sayit-hono.audreyt.workers.dev/api/speech_index.json';
	const speakersIndexUrl =
		process.env.SPEAKERS_INDEX_URL ??
		'https://sayit-hono.audreyt.workers.dev/api/speakers_index.json';
	let speechIndex: Array<{ filename: string; display_name: string }> = [];
	let speakersIndex: Array<{ id: number; route_pathname: string; name: string; photoURL: string | null }> = [];
	let speechSource = speechIndexUrl;
	let speakersSource = speakersIndexUrl;

	try {
		const res = await fetch(speechIndexUrl);
		if (!res.ok) {
			throw new Error(`Unexpected status ${res.status}`);
		}
		speechIndex = await res.json();
	} catch (error) {
		console.warn(`[prerender] 無法取得 speech index，將輸出空列表：${String(error)}`);
		speechSource = `${speechIndexUrl} (fetch failed)`;
	}

	try {
		const res = await fetch(speakersIndexUrl);
		if (!res.ok) {
			throw new Error(`Unexpected status ${res.status}`);
		}
		speakersIndex = await res.json();
	} catch (error) {
		console.warn(`[prerender] 無法取得 speakers index，將輸出空列表：${String(error)}`);
		speakersSource = `${speakersIndexUrl} (fetch failed)`;
	}

	const pages: PageSpec[] = [
		{
			filename: 'index.html',
			head: headForHome(),
			styles: mergeStyles(views.HomeViewStyles, sharedStyles),
			component: views.HomeView,
			components: sharedComponents
		},
		{
			filename: 'speeches.html',
			head: headForSpeeches(),
			styles: mergeStyles(views.SpeechesViewStyles, sharedStyles),
			component: views.SpeechesView,
			components: sharedComponents,
			props: { speeches: speechIndex, source: speechSource },
			aliases: ['speeches/index.html']
		},
		{
			filename: 'speakers.html',
			head: headForSpeakers(),
			styles: mergeStyles(views.SpeakersViewStyles, sharedStyles),
			component: views.SpeakersView,
			components: sharedComponents,
			props: { speakers: speakersIndex, source: speakersSource },
			aliases: ['speakers/index.html']
		}
	];

	await Promise.all(pages.map(renderPage));

	const speechPages: PageSpec[] = [];
	for (const speech of speechIndex) {
		try {
			const rawSections = await fetchSpeechSections(speech.filename);
			const sections = normalizeSections(rawSections);

			const decodedSlug = decodeURIComponent(speech.filename);
			const filename = `${decodedSlug}.html`;
			const aliases = [path.join(decodedSlug, 'index.html')];

			speechPages.push({
				filename,
				head: headForSingleSpeech(speech.display_name),
				styles: mergeStyles(views.SingleSpeechViewStyles, sharedStyles),
				component: views.SingleSpeechView,
				components: sharedComponents,
				props: { sections, speechName: speech.filename, displayName: speech.display_name },
				aliases
			});
		} catch (error) {
			console.warn(`[prerender] 無法產生 ${speech.filename}：${String(error)}`);
		}
	}

	for (const page of speechPages) {
		await renderPage(page);
	}

	const speakerPages: PageSpec[] = [];
	for (const speaker of speakersIndex) {
		try {
			const detail = await fetchSpeakerDetail(speaker.route_pathname);

			const decodedSlug = decodeURIComponent(speaker.route_pathname);
			const filename = path.join('speaker', `${decodedSlug}.html`);
			const aliases = [path.join('speaker', decodedSlug, 'index.html')];

			speakerPages.push({
				filename,
				head: headForSpeaker(speaker.route_pathname),
				styles: mergeStyles(views.SingleSpeakerViewStyles, sharedStyles),
				component: views.SingleSpeakerView,
				components: sharedComponents,
				props: { initialSpeaker: detail, routePathname: speaker.route_pathname },
				scripts: '<script src="/static/speeches/js/masonry.pkgd.min.js"></script>',
				aliases
			});
		} catch (error) {
			console.warn(`[prerender] 無法產生 speaker ${speaker.route_pathname}：${String(error)}`);
		}
	}

	for (const page of speakerPages) {
		await renderPage(page);
	}

	// 將 public 複製到 www，以支援預覽與部署靜態資源
	const publicDir = path.resolve('public');
	const outDir = path.resolve('www');
	// 保留與 public 相同的目錄結構（含根層 favicon/robots 與 static 目錄）
	await cp(publicDir, outDir, { recursive: true });
}

prerender().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

