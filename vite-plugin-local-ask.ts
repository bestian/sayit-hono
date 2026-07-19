import type { Plugin, ViteDevServer } from 'vite';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdirSync, existsSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function listening(port: number, timeoutMs: number): Promise<boolean> {
	return new Promise((resolvePromise) => {
		const socket = createConnection({ host: '127.0.0.1', port });
		const timer = setTimeout(() => {
			socket.destroy();
			resolvePromise(false);
		}, timeoutMs);
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
async function waitListening(port: number, timeoutMs: number): Promise<boolean> {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		if (await listening(port, 1000)) return true;
		await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250));
	}
	return false;
}
export default function localAsk(port: number): Plugin {
	return {
		name: 'local-ask',
		apply: 'serve',
		async configureServer(server: ViteDevServer) {
			if (await listening(port, 1000)) {
				server.config.logger.info(`[local-ask] reusing listening service on 127.0.0.1:${port}`);
			} else {
				const cwd = resolve(server.config.root, '../askit-hono');
				const wrangler = resolve(cwd, 'node_modules/wrangler/bin/wrangler.js');
				if (!existsSync(wrangler)) {
					server.config.logger.warn('[local-ask] sibling ../askit-hono or Wrangler missing; Ask unavailable');
				} else {
					const stateDir = resolve(server.config.root, '.wrangler');
					mkdirSync(stateDir, { recursive: true });
					const child = spawn(process.execPath, [wrangler, 'dev', '--port', String(port)], {
						cwd,
						detached: true,
						stdio: 'inherit',
					});
					child.once('error', (error) => server.config.logger.warn(`[local-ask] sibling failed to launch: ${error.message}`));
					child.unref();
					child.once('exit', (code, signal) => {
						if (code !== 0) server.config.logger.warn(`[local-ask] sibling exited before readiness (${code ?? signal})`);
					});
					const statePath = resolve(stateDir, 'local-ask.json');
					writeFileSync(
						statePath,
						JSON.stringify({ pid: child.pid, port, command: [process.execPath, wrangler, 'dev', '--port', String(port)] }),
					);
					if (!(await waitListening(port, 15000))) {
						server.config.logger.warn('[local-ask] listener did not become ready; Ask unavailable');
						try {
							if (child.pid) process.kill(-child.pid, 'SIGTERM');
						} catch {}
						try {
							if (child.pid && existsSync(statePath) && JSON.parse(readFileSync(statePath, 'utf8')).pid === child.pid)
								unlinkSync(statePath);
						} catch {}
					} else {
						server.config.logger.info(`[local-ask] started persistent sibling Ask listening on 127.0.0.1:${port}`);
					}
				}
			}
		},
	};
}
