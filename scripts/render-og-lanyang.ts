#!/usr/bin/env bun
/**
 * Local Lanyang OG preview (licensed Mac only). Compare with archive.tw production PNG.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { lanyangFontsInstalled, renderLanyangSpeechPng } from './og-lanyang-lib';

const FILENAME = '2026-06-25-商周專欄-當-ai-模型像晶片一樣被管制';
const DISPLAY_NAME = '2026-06-25 商周專欄：當 AI 模型像晶片一樣被管制';
const SPEAKERS = ['唐鳳'];

async function main() {
	if (!lanyangFontsInstalled()) {
		console.error('jf Lanyang fonts required under ~/Library/Fonts');
		process.exit(1);
	}

	const png = await renderLanyangSpeechPng(FILENAME, DISPLAY_NAME, SPEAKERS);
	const outDir = join(import.meta.dirname, '..', 'local-og-compare');
	mkdirSync(outDir, { recursive: true });
	const outPath = join(outDir, '2026-06-25-商周專欄-lanyang-local.png');
	writeFileSync(outPath, png);
	console.log(`Wrote ${outPath} (${png.length} bytes)`);
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
