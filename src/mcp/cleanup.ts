/**
 * Walk the process tree via `pgrep -P` and SIGTERM all descendants.
 * Mirrors OpenCode's cleanup approach for stdio MCP servers.
 */
export async function killDescendants(pid: number): Promise<void> {
	if (process.platform === 'win32') {
		return;
	}

	try {
		const proc = Bun.spawn(['pgrep', '-P', String(pid)], { stdout: 'pipe' });
		const output = await new Response(proc.stdout).text();
		const childPids = output
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((value) => Number.parseInt(value, 10))
			.filter((value) => Number.isFinite(value));

		for (const childPid of childPids) {
			await killDescendants(childPid);
			try {
				process.kill(childPid, 'SIGTERM');
			} catch {
				// Best-effort cleanup: the child may have exited between pgrep and kill.
			}
		}
	} catch {
		// pgrep exits non-zero when no children exist; shutdown cleanup must not throw.
	}
}
