import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const execFile = promisify(execFileCallback);

type TableSpec = {
	table: string;
	init: string;
	fill: string;
};

const TABLES: TableSpec[] = [
	{ table: 'speech_index', init: 'sql/init-speech_index.sql', fill: 'sql/fill-speech_index.sql' },
	{ table: 'speakers', init: 'sql/init-speakers.sql', fill: 'sql/fill-speakers.sql' },
];

let seedPromise: Promise<void> | undefined;

async function wrangler(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
	try {
		const result = await execFile('bunx', ['wrangler', 'd1', 'execute', 'sayit-database', '--local', ...args], {
			cwd: process.cwd(),
			maxBuffer: 10 * 1024 * 1024,
		});
		return { status: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		const result = error as { code?: number; stdout?: string; stderr?: string; message?: string };
		return {
			status: typeof result.code === 'number' ? result.code : 1,
			stdout: result.stdout ?? '',
			stderr: result.stderr ?? result.message ?? '',
		};
	}
}

function countFromJson(text: string): number | undefined {
	try {
		const value: unknown = JSON.parse(text);
		const visit = (node: unknown): number | undefined => {
			if (Array.isArray(node)) {
				for (const item of node) {
					const found = visit(item);
					if (found !== undefined) return found;
				}
			} else if (node && typeof node === 'object') {
				for (const [key, item] of Object.entries(node)) {
					if (key.toLowerCase() === 'count' && (typeof item === 'number' || typeof item === 'string')) {
						const count = Number(item);
						if (Number.isFinite(count)) return count;
					}
					const found = visit(item);
					if (found !== undefined) return found;
				}
			}
			return undefined;
		};
		return visit(value);
	} catch {
		return undefined;
	}
}

async function seedLocalIndexes(): Promise<void> {
	for (const spec of TABLES) {
		const probe = await wrangler(['--command', `SELECT COUNT(*) AS count FROM ${spec.table};`, '--json']);
		if (probe.status === 0) {
			const count = countFromJson(probe.stdout);
			if (count === undefined) throw new Error(`[local-d1] Could not parse ${spec.table} count from Wrangler JSON output`);
			if (count > 0) {
				console.log(`[local-d1] ${spec.table}: populated (${count}), skipping seed`);
				continue;
			}
			console.log(`[local-d1] ${spec.table}: exists but empty; importing fill SQL`);
		} else if (/no such table|does not exist/i.test(probe.stderr + probe.stdout)) {
			console.log(`[local-d1] ${spec.table}: missing; importing init and fill SQL`);
			const init = await wrangler(['--file', resolve(process.cwd(), spec.init)]);
			if (init.status !== 0) throw new Error(`[local-d1] Failed to initialize ${spec.table}: ${init.stderr || init.stdout}`);
		} else {
			throw new Error(`[local-d1] Failed probing ${spec.table}: ${probe.stderr || probe.stdout}`);
		}
		const fill = await wrangler(['--file', resolve(process.cwd(), spec.fill)]);
		if (fill.status !== 0) throw new Error(`[local-d1] Failed to fill ${spec.table}: ${fill.stderr || fill.stdout}`);
	}
}

export function localD1SeedPlugin(): Plugin {
	return {
		name: 'local-d1-seed',
		apply: 'serve',
		enforce: 'pre',
		configureServer() {
			seedPromise ??= seedLocalIndexes();
			return seedPromise;
		},
	};
}
