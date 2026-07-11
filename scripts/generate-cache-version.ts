// Generates src/cacheKeyVersion.ts from the current git commit hash.
// Every deploy gets a unique cache key, so stale R2-cached HTML is never served.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const hash = execSync('git rev-parse --short HEAD').toString().trim();
const version = `v-${hash}`;

const outPath = path.resolve('src/cacheKeyVersion.ts');
writeFileSync(
	outPath,
	`// Auto-generated at deploy time by scripts/generate-cache-version.ts\n` +
		`// Do not edit manually — this is overwritten on every deploy.\n` +
		`export const CACHE_KEY_VERSION = '${version}';\n` +
		`export const OLD_CACHE_VERSIONS: string[] = [];\n`,
);

console.log(`Cache version: ${version}`);
