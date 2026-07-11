#!/usr/bin/env bun
/**
 * Paginated R2 audit: speech OG keys vs speech_index.json.
 * Uses Cloudflare R2 List Objects API (not wrangler — no object list).
 *
 * GET /accounts/{account_id}/r2/buckets/{bucket}/objects
 *   ?prefix=v-{sha}/og/&per_page=1000&cursor=… until !result_info.is_truncated
 *
 * Expected keys: ${CACHE_KEY_VERSION}/og/${filename}.png
 * Actual speech keys: same prefix, .png, NOT …/og/speech/…
 *
 * Env: CLOUDFLARE_ACCOUNT_ID (or R2_ACCOUNT_ID), CLOUDFLARE_API_TOKEN
 * Usage: bun run scripts/audit-og-r2.ts (uses live /version unless CACHE_KEY_VERSION set)
 */
import { resolveCacheKeyVersion } from './lib/archive-cache-version';

const BUCKET = process.env.OG_R2_BUCKET ?? 'sayit-speech-cache';
const API_BASE = process.env.ARCHIVE_API_BASE ?? 'https://archive.tw';

type SpeechRow = { filename: string };

type ListObjectsResponse = {
	result?: Array<{ key: string }>;
	result_info?: { is_truncated?: boolean; cursor?: string };
	success?: boolean;
	errors?: Array<{ message: string }>;
};

async function resolveCacheVersion(): Promise<string> {
	return resolveCacheKeyVersion('v-unknown');
}

async function fetchSpeechIndex(): Promise<SpeechRow[]> {
	const res = await fetch(`${API_BASE}/api/speech_index.json`);
	if (!res.ok) throw new Error(`speech_index ${res.status}`);
	return (await res.json()) as SpeechRow[];
}

async function listAllObjectKeys(accountId: string, token: string, prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	let page = 0;
	do {
		const q = new URLSearchParams({ prefix, per_page: '1000' });
		if (cursor) q.set('cursor', cursor);
		const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects?${q}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const body = (await res.json()) as ListObjectsResponse;
		if (!res.ok || !body.success) {
			const msg = body.errors?.map((e) => e.message).join('; ') ?? (await res.text()).slice(0, 400);
			throw new Error(`List objects ${res.status}: ${msg}`);
		}
		for (const obj of body.result ?? []) keys.push(obj.key);
		const truncated = body.result_info?.is_truncated === true;
		cursor = truncated ? body.result_info?.cursor : undefined;
		page++;
		if (page > 500) throw new Error('pagination safety stop (>500 pages)');
	} while (cursor);
	return keys;
}

function isSpeechOgKey(key: string, version: string): boolean {
	const prefix = `${version}/og/`;
	if (!key.startsWith(prefix) || !key.endsWith('.png')) return false;
	if (key.startsWith(`${version}/og/speech/`)) return false;
	const rest = key.slice(prefix.length);
	return rest.length > 0 && !rest.includes('/');
}

async function main(): Promise<void> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID;
	const token = process.env.CLOUDFLARE_API_TOKEN;
	if (!accountId) {
		console.error('Missing CLOUDFLARE_ACCOUNT_ID (wrangler.jsonc has no account_id).');
		console.error('Run: npx wrangler whoami — use Account ID, or export CLOUDFLARE_ACCOUNT_ID.');
		process.exit(2);
	}
	if (!token) {
		console.error('Missing CLOUDFLARE_API_TOKEN (OAuth from wrangler login is not auto-exported).');
		process.exit(2);
	}

	const version = await resolveCacheVersion();
	const prefix = `${version}/og/`;
	const index = await fetchSpeechIndex();
	const expectedKeys = new Set(index.map((r) => `${version}/og/${r.filename}.png`));

	console.log(`CACHE_KEY_VERSION=${version}`);
	console.log(`speech_index expected keys: ${expectedKeys.size}`);

	const allKeys = await listAllObjectKeys(accountId, token, prefix);
	const speechKeys = allKeys.filter((k) => isSpeechOgKey(k, version));
	const quoteKeys = allKeys.filter((k) => k.startsWith(`${version}/og/speech/`));
	const actualSpeechKeys = new Set(speechKeys);

	const missing: string[] = [];
	for (const k of expectedKeys) if (!actualSpeechKeys.has(k)) missing.push(k);
	const extra: string[] = [];
	for (const k of actualSpeechKeys) if (!expectedKeys.has(k)) extra.push(k);

	console.log(`R2 list prefix ${prefix}: ${allKeys.length} keys (paginated)`);
	console.log(`  speech page PNGs: ${speechKeys.length}`);
	console.log(`  quote og/speech/* (excluded from diff): ${quoteKeys.length}`);
	console.log(`missing expected keys: ${missing.length}`);
	console.log(`extra speech keys not in index: ${extra.length}`);

	if (missing.length > 0) {
		console.log('missing (first 30):');
		for (const k of missing.slice(0, 30)) console.log(`  ${k}`);
	}
	if (extra.length > 0) {
		console.log('extra (first 20):');
		for (const k of extra.slice(0, 20)) console.log(`  ${k}`);
	}

	const ok = missing.length === 0 && extra.length === 0 && actualSpeechKeys.size === expectedKeys.size;
	console.log(ok ? 'MATCH: R2 speech OGs align with speech_index' : 'MISMATCH');
	process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
