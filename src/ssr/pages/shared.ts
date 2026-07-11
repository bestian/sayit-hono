import type { Context } from 'hono';
import type { ApiEnv } from '../../api/types';

export type WorkerEnv = ApiEnv['Bindings'];
export type AppContext = Context<{ Bindings: WorkerEnv }>;

export const PAGEFIND_SCRIPT = '<script src="/static/speeches/js/pagefind-search.js?v=au-fugu-12"></script>';
export const TWITTER_WIDGETS_SCRIPT = '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>';
export const STATS_SCRIPT = `<script>(function(){fetch('/stats.json').then(function(r){return r.json()}).then(function(s){var fmt=function(n){return n.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')};var e;e=document.getElementById('sayit-stat-speeches');if(e)e.textContent=fmt(s.speeches);e=document.getElementById('sayit-stat-speakers');if(e)e.textContent=fmt(s.speakers);e=document.getElementById('sayit-stat-sections');if(e)e.textContent=fmt(s.sections)}).catch(function(){})})()</script>`;

export function hasTwitterEmbed(contents: Array<string | null | undefined>): boolean {
	return contents.some((c) => typeof c === 'string' && c.includes('twitter-tweet'));
}

export const excludedPaths = [
	'api',
	'speeches',
	'speakers',
	'speaker',
	'speech',
	'og',
	'rss.xml',
	'feed.xml',
	'search',
	'privacy',
	'terms',
	'favicon.ico',
	'robots.txt',
	'static',
	'media',
	'index.html',
];

export function isExcludedPath(segment: string): boolean {
	return excludedPaths.includes(segment.toLowerCase());
}

export type Section = {
	filename: string;
	nest_filename?: string | null;
	nest_display_name?: string | null;
	section_id: number;
	previous_section_id: number | null;
	next_section_id: number | null;
	section_speaker: string | null;
	section_content: string;
	display_name: string;
	photoURL: string | null;
	name: string | null;
};

export type SpeechIndexRow = {
	filename: string;
	display_name: string;
	isNested: number | boolean;
	nest_filenames?: string | null;
	nest_display_names?: string | null;
};

export type SpeechListItem = {
	filename: string;
	display_name: string;
};

export type SpeakerListItem = {
	id: number;
	route_pathname: string;
	name: string;
	photoURL: string | null;
};

export type AlternateInfo = { url: string; label: string; displayName: string; hreflang: string };
