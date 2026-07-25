import { createExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createMockEnv } from './helpers/mockEnv';
import { splitSqlStatements } from '../src/db/local-dev-seed';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function loadLocalSeed() {
	vi.resetModules();
	// A static import would retain the seeder's module-scoped promise across cases.
	return import('../src/db/local-dev-seed');
}
describe('SQL seed parsing', () => {
	it('keeps quoted semicolons, skips comments, respects escaped quotes, and flushes a trailing statement', () => {
		const sql = `-- ignored local-only note
INSERT INTO example VALUES ('semi;colon', "double;semi", 'escaped \\' quote');
INSERT INTO example VALUES ('tail')`;

		expect(splitSqlStatements(sql)).toEqual([
			`INSERT INTO example VALUES ('semi;colon', "double;semi", 'escaped \\' quote');`,
			"INSERT INTO example VALUES ('tail')",
		]);
		expect(splitSqlStatements('-- comment only')).toEqual([]);
	});
});

describe('local D1 seed', () => {
	it('creates missing tables, refills incomplete tables, skips populated tables, and shares work', async () => {
		const counts: Array<number | Error | null> = [new Error('no such table: speech_speakers'), null, 0, Number.MAX_SAFE_INTEGER];
		const preparedSql: string[] = [];
		const executedSql: string[] = [];
		const db = {
			prepare(sql: string) {
				preparedSql.push(sql);
				return {
					async first<T = unknown>(): Promise<T | null> {
						const count = counts.shift();
						if (count instanceof Error) throw count;
						if (count === null) return null;
						return { count: count ?? 0 } as T;
					},
				};
			},
			async exec(sql: string): Promise<void> {
				executedSql.push(sql);
			},
		};
		const { ensureLocalIndexes } = await loadLocalSeed();

		const seeded = ensureLocalIndexes(db);
		expect(ensureLocalIndexes(db)).toBe(seeded);
		await seeded;

		expect(preparedSql).toHaveLength(4);
		expect(executedSql.length).toBeGreaterThan(0);
		expect(executedSql.some((sql) => sql.includes('CREATE TABLE'))).toBe(true);
		expect(executedSql.some((sql) => sql.split('\n').length === 75)).toBe(true);
		expect(executedSql.some((sql) => sql.includes('DROP TABLE IF EXISTS'))).toBe(false);
	});

	it('propagates an unexpected database error', async () => {
		const error = new Error('permission denied');
		let executed = false;
		const db = {
			prepare: () => ({
				async first(): Promise<never> {
					throw error;
				},
			}),
			async exec(): Promise<void> {
				executed = true;
			},
		};
		const { ensureLocalIndexes } = await loadLocalSeed();

		await expect(ensureLocalIndexes(db)).rejects.toBe(error);
		expect(executed).toBe(false);
	});
});

describe('local development worker behavior', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.doUnmock('../src/db/local-dev-seed');
		vi.doUnmock('../src/search/runtime');
		vi.resetModules();
	});

	it('seeds before requests and serves local stats when the compile-time flag is enabled', async () => {
		const ensureLocalIndexes = vi.fn(async () => {});
		const readCanonicalSearchStats = vi.fn(async () => ({ speeches: 4, sections: 12 }));
		vi.resetModules();
		vi.stubGlobal('__LOCAL_D1_SEED__', true);
		vi.doMock('../src/db/local-dev-seed', () => ({ ensureLocalIndexes }));
		vi.doMock('../src/search/runtime', () => ({ readCanonicalSearchStats }));
		// A static import would evaluate the compile-time flag before this test configures it.
		const { default: worker } = await import('../src/index');
		const env = createMockEnv(() => ({ results: [] }));

		const version = await worker.fetch(new IncomingRequest('https://example.com/version'), env, createExecutionContext());
		const stats = await worker.fetch(new IncomingRequest('https://example.com/stats.json'), env, createExecutionContext());

		expect(version.status).toBe(200);
		expect(await stats.json()).toEqual({ speeches: 4, sections: 12 });
		expect(ensureLocalIndexes).toHaveBeenCalledTimes(2);
		expect(readCanonicalSearchStats).toHaveBeenCalledWith(env.DB);
	});
});
