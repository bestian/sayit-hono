import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

/**
 * reserveSectionIds() throws when the atomic `UPDATE section_id_counter ...
 * RETURNING next_id` yields no row (e.g. a transient D1 fault). The handler must
 * surface that as HTTP 503, not allocate ids from a bad/NaN counter value.
 */
describe('reserveSectionIds failure handling', () => {
	it('returns 503 when the counter reservation returns no row', async () => {
		// Every query resolves to an empty result set, so the counter
		// UPDATE ... RETURNING .first() returns null -> reserveSectionIds throws.
		const query = () => ({ success: true, results: [] as any[] });

		const env = {
			AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
			BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
			ASSETS: { fetch: () => new Response('NF', { status: 404 }) },
			SPEECH_CACHE: {
				delete: async () => true,
				get: async () => null,
				put: async () => {},
				list: async () => ({ objects: [], truncated: false, cursor: '' }),
			},
			DB: {
				prepare: (sql: string) => {
					const statement = (args: unknown[] = []): any => ({
						sql,
						args,
						bind: (...bound: unknown[]) => statement(bound),
						first: async () => query().results[0] ?? null,
						all: async () => query(),
						run: async () => ({ success: true, meta: { changes: 1 } }),
					});
					return statement();
				},
				batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
			},
		};

		const req = new IncomingRequest('https://example.com/api/upload_markdown', {
			method: 'POST',
			headers: { Authorization: 'Bearer token-audrey', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'no-counter', markdown: '# Title\n\nhello world' }),
		});
		const ctx = createExecutionContext();
		const res = await worker.fetch(req, env as any, ctx);
		expect(res.status).toBe(503);
	});
});
