import { createExecutionContext } from 'cloudflare:test';
import worker from '../../src/index';

/** A single D1 `prepare(sql).bind(...args)` call result, as returned by a QueryResolver. */
export interface QueryResult {
	success?: boolean;
	results: unknown[];
}

/** Per-test SQL responder: matches on the query text (usually via `sql.includes(...)`) and returns rows. */
export type QueryResolver = (sql: string, args: unknown[]) => QueryResult;

/** A single D1 `batch()` statement, as captured for assertions on write-path tests. */
export interface PreparedStatement {
	sql: string;
	args: unknown[];
}

/** Bindings shape this repo's Worker actually consumes in every route — the full mock env surface. */
export interface MockWorkerEnv {
	AUDREYT_TRANSCRIPT_TOKEN: string;
	BESTIAN_TRANSCRIPT_TOKEN: string;
	ASSETS: { fetch: () => Response };
	SPEECH_CACHE: MockR2Bucket;
	DB: MockD1Database;
	/** Statements passed to `DB.batch()`, captured in call order for assertions. */
	__batchedStatements: PreparedStatement[];
	/** Statements run directly via `.bind(...).run()` (outside a `batch()` call), captured in call order. */
	__directStatements: PreparedStatement[];
	/** Backing store for SPEECH_CACHE, exposed so a test can pre-seed or assert on raw entries. */
	__r2Store: Map<string, MockR2Entry>;
}

export interface MockR2Entry {
	body: string | Uint8Array;
	cacheControl?: string;
	contentType?: string;
	etag?: string;
	customMetadata?: Record<string, string>;
}

interface MockR2Bucket {
	get: (key: string) => Promise<MockR2GetResult | null>;
	put: (
		key: string,
		body: string,
		options?: { httpMetadata?: { cacheControl?: string; contentType?: string }; customMetadata?: Record<string, string> },
	) => Promise<void>;
	delete: (keys: string | string[]) => Promise<void>;
	list: () => Promise<{ objects: unknown[]; truncated: boolean; cursor: string }>;
}

interface MockR2GetResult {
	body: string | Uint8Array;
	size: number;
	httpEtag: string | null;
	httpMetadata: { cacheControl?: string; contentType?: string };
	customMetadata?: Record<string, string>;
	text: () => Promise<string>;
}

export interface MockD1PreparedStatement {
	bind: (...args: unknown[]) => MockD1BoundStatement;
	first: () => Promise<unknown>;
	all: () => Promise<QueryResult>;
	run: () => Promise<QueryResult>;
}

export interface MockD1BoundStatement {
	sql: string;
	args: unknown[];
	first: () => Promise<unknown>;
	all: () => Promise<QueryResult>;
	run: () => Promise<QueryResult>;
}

interface MockD1Database {
	prepare: (sql: string) => MockD1PreparedStatement;
	batch: (statements: PreparedStatement[]) => Promise<Array<{ meta: { changes: number } }>>;
}

/**
 * Runs `resolver` on the next microtask before resolving/rejecting. This
 * matters for tests that make the resolver `throw` to simulate a D1 failure:
 * deferring past the current microtask means the SUT's `await` has already
 * attached itself as the promise's awaiter by the time the rejection fires,
 * so the SUT's own try/catch observes it as a normal rejected await instead
 * of pool-workers' runtime flagging an early/unhandled rejection.
 */
function resolveOnMicrotask(resolver: QueryResolver, sql: string, args: unknown[]): Promise<QueryResult> {
	const { promise, resolve, reject } = Promise.withResolvers<QueryResult>();
	queueMicrotask(() => {
		try {
			resolve(resolver(sql, args));
		} catch (err) {
			reject(err);
		}
	});
	return promise;
}

/**
 * Builds a mock Worker env: a D1 database driven by a caller-supplied
 * QueryResolver, an in-memory R2 bucket (optionally pre-seeded), and the
 * ASSETS/token bindings every route touches. This is the one place that
 * shapes cloudflare:workers bindings for tests — SQL-matching logic stays
 * in each spec file's own resolver, since that's genuinely test-specific.
 */
export function createMockEnv(resolver: QueryResolver, options: { preSeedR2?: Record<string, MockR2Entry> } = {}): MockWorkerEnv {
	const r2Store = new Map<string, MockR2Entry>();
	for (const [key, entry] of Object.entries(options.preSeedR2 ?? {})) {
		r2Store.set(key, { cacheControl: 'public, max-age=3600', contentType: 'text/html; charset=utf-8', ...entry });
	}

	const batchedStatements: PreparedStatement[] = [];
	const directStatements: PreparedStatement[] = [];

	return {
		AUDREYT_TRANSCRIPT_TOKEN: 'token-audrey',
		BESTIAN_TRANSCRIPT_TOKEN: 'token-bestian',
		ASSETS: { fetch: () => new Response('Not Found', { status: 404 }) },
		SPEECH_CACHE: {
			get: async (key) => {
				const entry = r2Store.get(key);
				if (!entry) return null;
				return {
					body: entry.body,
					size: entry.body.length,
					httpEtag: entry.etag ?? null,
					httpMetadata: { cacheControl: entry.cacheControl, contentType: entry.contentType },
					customMetadata: entry.customMetadata,
					// Real R2ObjectBody.text() decodes bytes as UTF-8 regardless of
					// content type — src/api/cache.ts's readR2Cache calls it
					// unconditionally even for binary (PNG) entries, so the mock
					// matches that exact behavior rather than special-casing it.
					text: async () => (typeof entry.body === 'string' ? entry.body : new TextDecoder().decode(entry.body)),
				};
			},
			put: async (key, body, putOptions) => {
				r2Store.set(key, {
					body,
					cacheControl: putOptions?.httpMetadata?.cacheControl,
					contentType: putOptions?.httpMetadata?.contentType,
					customMetadata: putOptions?.customMetadata,
				});
			},
			delete: async (keys) => {
				for (const key of Array.isArray(keys) ? keys : [keys]) r2Store.delete(key);
			},
			list: async () => ({ objects: [], truncated: false, cursor: '' }),
		},
		DB: {
			prepare: (sql) => {
				const bind = (...args: unknown[]): MockD1BoundStatement => ({
					sql,
					args,
					first: async () => (await resolveOnMicrotask(resolver, sql, args)).results[0] ?? null,
					all: async () => resolveOnMicrotask(resolver, sql, args),
					run: async () => {
						directStatements.push({ sql, args });
						return resolveOnMicrotask(resolver, sql, args);
					},
				});
				return { bind, first: () => bind().first(), all: () => bind().all(), run: () => bind().run() };
			},
			batch: async (statements) => {
				batchedStatements.push(...statements);
				return statements.map(() => ({ meta: { changes: 1 } }));
			},
		},
		__batchedStatements: batchedStatements,
		__directStatements: directStatements,
		__r2Store: r2Store,
	};
}

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

/** Dispatches one request through the real Worker against a mock env, matching test/*'s established pattern. */
export async function dispatch(
	path: string,
	env: MockWorkerEnv,
	init?: RequestInit<IncomingRequestCfProperties>,
): Promise<{ res: Response }> {
	const req = new IncomingRequest(`https://example.com${path}`, init);
	const ctx = createExecutionContext();
	// Hono's `app.fetch(request, Env?, executionCtx?)` types `Env` as `Bindings | {}` —
	// the mock env's shape never needs bridging to the real WorkerEnv/D1Database/R2Bucket
	// types here; any object is structurally accepted, no cast required.
	const res = await worker.fetch(req, env, ctx);
	return { res };
}
