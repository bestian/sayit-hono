import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';

const statePath = resolve(process.cwd(), '.wrangler/local-ask.json');
if (!existsSync(statePath)) process.exit(0);
let state;
try {
	state = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
	unlinkSync(statePath);
	process.exit(0);
}
const rootPid = Number(state?.pid);
const expected = Array.isArray(state?.command) ? state.command.map(String) : [];
const expectedWrangler = expected[1];
const expectedArgs = expected.slice(2);
const port = Number(state?.port ?? 8787);
if (!Number.isInteger(rootPid) || rootPid <= 0 || !expectedWrangler || !expectedArgs.length || !Number.isInteger(port)) {
	unlinkSync(statePath);
	process.exit(0);
}
function snapshot() {
	const lines = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n');
	return lines.flatMap((line) => {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
		return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : [];
	});
}
let processes;
try {
	processes = snapshot();
} catch {
	console.error('[local-ask] unable to inspect processes safely');
	process.exit(1);
}
const root = processes.find((entry) => entry.pid === rootPid);
if (!root || !root.command.includes(expectedWrangler) || !expectedArgs.every((argument) => root.command.includes(argument))) {
	console.error(`[local-ask] refusing to stop PID ${rootPid}: recorded Wrangler command is not running`);
	process.exit(1);
}
const descendants = [];
const pending = [rootPid];
while (pending.length) {
	const parent = pending.pop();
	for (const entry of processes)
		if (entry.ppid === parent) {
			descendants.push(entry);
			pending.push(entry.pid);
		}
}
const targets = [...descendants, root].sort((a, b) => b.pid - a.pid);
for (const entry of targets) {
	try {
		process.kill(entry.pid, 'SIGTERM');
	} catch (error) {
		if (error.code !== 'ESRCH') throw error;
	}
}
function listening() {
	return new Promise((resolvePromise) => {
		const socket = createConnection({ host: '127.0.0.1', port });
		const timer = setTimeout(() => {
			socket.destroy();
			resolvePromise(false);
		}, 250);
		socket.once('connect', () => {
			clearTimeout(timer);
			socket.destroy();
			resolvePromise(true);
		});
		socket.once('error', () => {
			clearTimeout(timer);
			socket.destroy();
			resolvePromise(false);
		});
	});
}
for (let attempt = 0; attempt < 20 && (await listening()); attempt++)
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
if (await listening()) {
	const current = snapshot();
	for (const entry of targets) {
		const live = current.find((candidate) => candidate.pid === entry.pid);
		if (live && live.command === entry.command) {
			try {
				process.kill(entry.pid, 'SIGKILL');
			} catch (error) {
				if (error.code !== 'ESRCH') throw error;
			}
		}
	}
	for (let attempt = 0; attempt < 10 && (await listening()); attempt++)
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
}
if (await listening()) {
	console.error(`[local-ask] port ${port} remains active; state retained`);
	process.exit(1);
}
unlinkSync(statePath);
console.log(`[local-ask] stopped recorded Ask descendant tree rooted at ${rootPid}`);
