// Refuse to run deploy scripts under bun — wrangler deploy silently fails
// (exit code 0, no upload) when invoked through bun's runtime. Must use node.
const isBun =
	typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ||
	typeof (process.versions as { bun?: string }).bun === 'string';

if (isBun) {
	console.error('✗ Refusing to deploy under bun runtime.');
	console.error('  wrangler deploy silently fails under bun (exit 0, no upload).');
	console.error('  Use: npm run deploy:search   (or: npx wrangler deploy)');
	process.exit(1);
}
