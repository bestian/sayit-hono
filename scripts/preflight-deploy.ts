// Before wrangler deploy, refuse to overwrite the live worker with an older
// commit. Reads /version from production and exits 1 if the currently-deployed
// commit is not an ancestor of local HEAD (i.e. we'd be regressing).
//
// Why: the transcript repo's sync workflow has been silently deploying a
// stale fork, rolling back features. verify-deploy.ts only checks "did our
// upload land?" — it can't tell that what we're uploading is older than what
// was live a moment ago. This script is that missing guard.
import { execSync } from 'node:child_process';

const url = process.env.PREFLIGHT_URL ?? process.env.VERIFY_URL ?? 'https://archive.tw/version';

function git(cmd: string): string {
	return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim();
}

function gitOk(cmd: string): boolean {
	try {
		execSync(`git ${cmd}`, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

async function fetchLiveSha(): Promise<string | null> {
	let body: { version?: string };
	try {
		const res = await fetch(`${url}?_=${Date.now()}`, {
			cache: 'no-store',
			headers: { 'Cache-Control': 'no-cache' },
		});
		if (!res.ok) {
			console.warn(`[preflight] /version returned HTTP ${res.status}; skipping ancestor check`);
			return null;
		}
		body = (await res.json()) as { version?: string };
	} catch (err) {
		console.warn(`[preflight] could not reach ${url} (${String(err)}); skipping ancestor check`);
		return null;
	}
	const version = body.version ?? '';
	const match = version.match(/^v-([0-9a-f]{4,40})$/);
	if (!match) {
		console.warn(`[preflight] /version returned unexpected shape; skipping ancestor check`);
		return null;
	}
	return match[1];
}

async function main() {
	const liveSha = await fetchLiveSha();
	if (!liveSha) return;

	const headSha = git('rev-parse HEAD');
	const headShort = git('rev-parse --short HEAD');

	if (!gitOk(`cat-file -e ${liveSha}^{commit}`)) {
		console.error(`✗ Preflight failed: live worker commit ${liveSha} is not in this repo.`);
		console.error(`  Fetch the missing history before deploying:`);
		console.error(`    git fetch origin`);
		console.error(`  If it's still missing, the live worker was deployed from a different fork.`);
		process.exit(1);
	}

	if (headSha === liveSha) {
		console.log(`✓ Preflight: HEAD already matches live ${liveSha.slice(0, 7)} — redeploy is a no-op for code, OK.`);
		return;
	}

	if (!gitOk(`merge-base --is-ancestor ${liveSha} HEAD`)) {
		console.error(`✗ Preflight failed: refusing to deploy a commit that's not ahead of the live worker.`);
		console.error(`  HEAD:        ${headShort} (${headSha})`);
		console.error(`  Live worker: ${liveSha}`);
		console.error(`  HEAD does not contain the live commit, so deploying would roll back changes.`);
		console.error(`  Either:`);
		console.error(`    git fetch origin && git checkout main && git pull --ff-only origin main`);
		console.error(`  Or, if you really mean to overwrite live with this branch:`);
		console.error(`    PREFLIGHT_URL=skip bun run deploy   # bypasses this check`);
		process.exit(1);
	}

	console.log(`✓ Preflight: HEAD ${headShort} is a descendant of live ${liveSha.slice(0, 7)}.`);
}

if (process.env.PREFLIGHT_URL === 'skip') {
	console.warn('[preflight] PREFLIGHT_URL=skip set — bypassing ancestor check');
} else {
	main().catch((err) => {
		console.error('[preflight] crashed:', err);
		process.exit(1);
	});
}
