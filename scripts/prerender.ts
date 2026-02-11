import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function prerender() {
	// 所有頁面皆已改為 SSR + R2 快取，不再 prerender HTML
	// 僅複製 public 靜態資源到 www/

	const publicDir = path.resolve('public');
	const outDir = path.resolve('www');
	await mkdir(outDir, { recursive: true });
	await cp(publicDir, outDir, { recursive: true, force: true });
	console.log(`[prerender] 已複製 public/ 到 www/（包含 media/ 目錄）`);
}

prerender().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
