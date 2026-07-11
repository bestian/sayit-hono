import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vite-plus/test';

const D1_PROBE_TABLE = 'local_runtime_bindings_d1_probe';
const R2_PROBE_KEY = 'local-runtime-bindings-r2-probe.txt';

/**
 * Other specs use fast JS stand-ins for DB/R2/assets, so they cannot catch
 * regressions where real bindings require `wrangler dev`, remote resources,
 * or another external service. This spec proves the embedded
 * `@cloudflare/vitest-pool-workers` runtime provides real D1, R2, assets, and
 * end-to-end Worker dispatch with no external process. Probe names are
 * test-specific and stable, making cleanup deterministic and collision-safe
 * across the pool's isolated runtimes.
 */

describe('local Workers runtime bindings (self-contained, no external dev server)', () => {
	it('DB is a real local D1 database (create/insert/query/drop round-trip)', async () => {
		await env.DB.exec(`CREATE TABLE IF NOT EXISTS ${D1_PROBE_TABLE} (id INTEGER PRIMARY KEY, label TEXT NOT NULL)`);
		try {
			await env.DB.prepare(`INSERT INTO ${D1_PROBE_TABLE} (label) VALUES (?)`).bind('local-miniflare').run();
			const row = await env.DB.prepare(`SELECT label FROM ${D1_PROBE_TABLE} WHERE label = ?`)
				.bind('local-miniflare')
				.first<{ label: string }>();
			expect(row?.label).toBe('local-miniflare');
		} finally {
			await env.DB.exec(`DROP TABLE ${D1_PROBE_TABLE}`);
		}
	});

	it('SPEECH_CACHE is a real local R2 bucket (put/get/delete round-trip)', async () => {
		await env.SPEECH_CACHE.put(R2_PROBE_KEY, 'local-miniflare-r2');
		try {
			const obj = await env.SPEECH_CACHE.get(R2_PROBE_KEY);
			expect(await obj?.text()).toBe('local-miniflare-r2');
		} finally {
			await env.SPEECH_CACHE.delete(R2_PROBE_KEY);
		}
	});

	it('ASSETS serves the real public/ directory with no network dependency', async () => {
		const res = await env.ASSETS.fetch('https://assets.local/robots.txt');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('User-agent: *');
	});

	it('dispatches a real request through the Worker entrypoint end-to-end, entirely locally', async () => {
		const res = await SELF.fetch('https://example.com/robots.txt');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('User-agent: *');
	});
});
