import { DurableObject } from 'cloudflare:workers';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// A unit represents one full speech-content scan. The API performs one;
// the HTML page also counts matching sections before fetching its page.
export const SEARCH_CLIENT_REQUESTS_PER_MINUTE = 10;
export const SEARCH_SITE_UNITS_PER_MINUTE = 60;
export const SEARCH_SITE_UNITS_PER_DAY = 1_000;

export type SearchAdmission = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type CountRow = { used: number };
type AdmissionRow = { at_ms: number; units: number };

function secondsUntilEnoughExpire(rows: AdmissionRow[], unitsNeeded: number, windowMs: number, now: number): number {
	let expiredUnits = 0;
	let expiry = rows.at(-1)!.at_ms + windowMs;
	for (const row of rows) {
		expiredUnits += row.units;
		if (expiredUnits >= unitsNeeded) {
			expiry = row.at_ms + windowMs;
			break;
		}
	}
	return Math.max(1, Math.ceil((expiry - now) / 1_000));
}

/** One sitewide object is intentional: a single admission point makes the total budget exact. */
export class SearchBudget extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS admissions (
					at_ms INTEGER NOT NULL,
					client_key TEXT NOT NULL,
					units INTEGER NOT NULL
				);
				CREATE INDEX IF NOT EXISTS admissions_time ON admissions(at_ms);
				CREATE INDEX IF NOT EXISTS admissions_client_time ON admissions(client_key, at_ms);
			`);
		});
	}

	async admit(clientKey: string, units: 1 | 2): Promise<SearchAdmission> {
		if (!clientKey || clientKey.length > 80 || (units !== 1 && units !== 2)) return { allowed: false, retryAfterSeconds: 60 };
		const now = Date.now();
		const minuteCutoff = now - MINUTE_MS;
		const dayCutoff = now - DAY_MS;

		return this.ctx.storage.transactionSync(() => {
			// The 24-hour cap also bounds persistent rows to at most 1,000.
			this.ctx.storage.sql.exec('DELETE FROM admissions WHERE at_ms <= ?', dayCutoff);
			const clientUsed = this.ctx.storage.sql
				.exec<CountRow>('SELECT COUNT(*) AS used FROM admissions WHERE client_key = ? AND at_ms > ?', clientKey, minuteCutoff)
				.one().used;
			const minuteUsed = this.ctx.storage.sql
				.exec<CountRow>('SELECT COALESCE(SUM(units), 0) AS used FROM admissions WHERE at_ms > ?', minuteCutoff)
				.one().used;
			const dayUsed = this.ctx.storage.sql.exec<CountRow>('SELECT COALESCE(SUM(units), 0) AS used FROM admissions').one().used;

			let retryAfterSeconds = 0;
			if (clientUsed >= SEARCH_CLIENT_REQUESTS_PER_MINUTE) {
				const oldest = this.ctx.storage.sql
					.exec<{ at_ms: number }>(
						'SELECT at_ms FROM admissions WHERE client_key = ? AND at_ms > ? ORDER BY at_ms LIMIT 1',
						clientKey,
						minuteCutoff,
					)
					.one().at_ms;
				retryAfterSeconds = Math.max(retryAfterSeconds, Math.max(1, Math.ceil((oldest + MINUTE_MS - now) / 1_000)));
			}
			if (minuteUsed + units > SEARCH_SITE_UNITS_PER_MINUTE) {
				const rows = this.ctx.storage.sql
					.exec<AdmissionRow>('SELECT at_ms, units FROM admissions WHERE at_ms > ? ORDER BY at_ms, rowid', minuteCutoff)
					.toArray();
				retryAfterSeconds = Math.max(
					retryAfterSeconds,
					secondsUntilEnoughExpire(rows, minuteUsed + units - SEARCH_SITE_UNITS_PER_MINUTE, MINUTE_MS, now),
				);
			}
			if (dayUsed + units > SEARCH_SITE_UNITS_PER_DAY) {
				const rows = this.ctx.storage.sql.exec<AdmissionRow>('SELECT at_ms, units FROM admissions ORDER BY at_ms, rowid').toArray();
				retryAfterSeconds = Math.max(
					retryAfterSeconds,
					secondsUntilEnoughExpire(rows, dayUsed + units - SEARCH_SITE_UNITS_PER_DAY, DAY_MS, now),
				);
			}
			if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds };

			this.ctx.storage.sql.exec('INSERT INTO admissions (at_ms, client_key, units) VALUES (?, ?, ?)', now, clientKey, units);
			return { allowed: true };
		});
	}
}
