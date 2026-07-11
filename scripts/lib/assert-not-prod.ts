/**
 * Central safety guard for any script that writes to a Cloudflare R2 bucket
 * (or other named resource) with `--remote`. Default-safe: refuses to target
 * a resource that doesn't look like a non-production resource unless the
 * caller explicitly opts in with `ALLOW_PROD_R2=1`.
 *
 * Call this immediately before any `wrangler r2 object put/delete ...
 * --remote` (or equivalent) whose target bucket/resource name is derived
 * from a variable rather than a literal you're staring at right now.
 *
 * Suffix-based (not an exact-name blocklist) so a brand-new production
 * resource is refused by default too, not just the ones enumerated today.
 */
const SAFE_SUFFIXES = ['-staging', '-preview'];

export function assertNotProd(resourceName: string): void {
	if (SAFE_SUFFIXES.some((suffix) => resourceName.endsWith(suffix))) return;

	if (process.env.ALLOW_PROD_R2 === '1') {
		console.warn(
			`[assert-not-prod] ALLOW_PROD_R2=1 set — proceeding against "${resourceName}", which does not look like a staging/preview resource.`,
		);
		return;
	}

	throw new Error(
		`Refusing to write to "${resourceName}": it doesn't end in -staging or -preview, so it looks ` +
			`like production. If this really is an intentional production write, set ALLOW_PROD_R2=1. ` +
			`Otherwise point the relevant env var at a -staging or -preview resource instead.`,
	);
}
