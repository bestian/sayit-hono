import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

async function buildAssets() {
	const publicDir = path.resolve('public');
	const outDir = path.resolve('www');

	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	await cp(publicDir, outDir, { recursive: true, force: true });

	console.log('[build-assets] copied public/ to www/');
}

buildAssets().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
