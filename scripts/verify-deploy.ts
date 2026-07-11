// After wrangler deploy, poll /version until it returns the CACHE_KEY_VERSION
// we just shipped. If it doesn't match after a few retries, the deploy silently
// failed and the old worker is still live — fail the script so CI/operator sees it.
import { CACHE_KEY_VERSION } from '../src/cacheKeyVersion';

const url = process.env.VERIFY_URL ?? 'https://archive.tw/version';
const maxAttempts = 6;
const delayMs = 2000;

async function fetchVersion(): Promise<string | null> {
	const res = await fetch(`${url}?_=${Date.now()}`, {
		cache: 'no-store',
		headers: { 'Cache-Control': 'no-cache' },
	});
	if (!res.ok) {
		console.warn(`  HTTP ${res.status} from ${url}`);
		return null;
	}
	const body = (await res.json()) as { version?: string };
	return body.version ?? null;
}

async function main() {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const got = await fetchVersion();
			if (got === CACHE_KEY_VERSION) {
				console.log(`✓ Deploy verified: ${url} returns ${CACHE_KEY_VERSION}`);
				return;
			}
			console.warn(`  attempt ${attempt}/${maxAttempts}: got ${got ?? 'null'}, want ${CACHE_KEY_VERSION}`);
		} catch (err) {
			console.warn(`  attempt ${attempt}/${maxAttempts}: ${err}`);
		}
		if (attempt < maxAttempts) {
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}

	console.error(`✗ Deploy verification FAILED.`);
	console.error(`  ${url} did not return ${CACHE_KEY_VERSION} after ${maxAttempts} attempts.`);
	console.error(`  The worker is likely still running an older version — wrangler deploy`);
	console.error(`  silently did nothing (common failure mode under bun runtime).`);
	console.error(
		`  Retry with: ${process.env.DEPLOY_RETRY_HINT ?? 'the same deploy command you just ran (check which --env you targeted before retrying)'}`,
	);
	process.exit(1);
}

main().catch((err) => {
	console.error('verify-deploy crashed:', err);
	process.exit(1);
});
