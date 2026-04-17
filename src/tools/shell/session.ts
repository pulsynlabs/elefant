import { existsSync } from 'node:fs';

import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { err, ok } from '../../types/result.js';

const DEFAULT_EXECUTION_TIMEOUT_MS = 120_000;
const SHUTDOWN_GRACE_MS = 500;

export interface ShellResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

interface ParsedStdout {
	stdout: string;
	exitCode: number;
	consumedUntil: number;
}

interface WritableShellStdin {
	write(chunk: string): unknown;
}

class ShellTimeoutError extends Error {
	public constructor(timeoutMs: number) {
		super(`Shell command timed out after ${timeoutMs}ms`);
		this.name = 'ShellTimeoutError';
	}
}

function normalizeOutput(value: string): string {
	return value.replace(/\r?\n$/, '');
}

function createShellError(code: ElefantError['code'], message: string, details?: unknown): ElefantError {
	return {
		code,
		message,
		details,
	};
}

export function resolveShellPath(): string | null {
	if (existsSync('/bin/bash')) {
		return '/bin/bash';
	}

	if (existsSync('/bin/sh')) {
		return '/bin/sh';
	}

	return null;
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return await Promise.race([
		promise,
		Bun.sleep(timeoutMs).then(() => {
			throw new ShellTimeoutError(timeoutMs);
		}),
	]);
}

export class ShellSession {
	private readonly process: ReturnType<typeof Bun.spawn>;
	private readonly stdin: WritableShellStdin;
	private readonly conversationId: string;
	private lastActivity: number;
	private stdoutBuffer = '';
	private stderrBuffer = '';
	private readonly waiters = new Set<() => void>();
	private executionChain: Promise<void> = Promise.resolve();
	private hasExited = false;

	public constructor(conversationId: string) {
		const shellPath = resolveShellPath();
		if (shellPath === null) {
			throw new Error('No supported shell found at /bin/bash or /bin/sh');
		}

		this.conversationId = conversationId;
		this.lastActivity = Date.now();
		this.process = Bun.spawn([shellPath], {
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe',
		});

		const stdin = this.process.stdin;
		if (typeof stdin !== 'object' || stdin === null || !('write' in stdin)) {
			throw new Error('Shell session stdin is not writable');
		}
		this.stdin = stdin as WritableShellStdin;

		const stdout = this.process.stdout;
		if (!(stdout instanceof ReadableStream)) {
			throw new Error('Shell session stdout is not readable');
		}

		const stderr = this.process.stderr;
		if (!(stderr instanceof ReadableStream)) {
			throw new Error('Shell session stderr is not readable');
		}

		this.startPump(stdout, 'stdout');
		this.startPump(stderr, 'stderr');
		this.process.exited.finally(() => {
			this.hasExited = true;
			this.notifyWaiters();
		});
	}

	public async execute(
		command: string,
		timeoutMs = DEFAULT_EXECUTION_TIMEOUT_MS,
	): Promise<Result<ShellResult, ElefantError>> {
		const runner = async (): Promise<Result<ShellResult, ElefantError>> => {
			if (!this.isAlive()) {
				return err(
					createShellError('TOOL_EXECUTION_FAILED', 'Shell session is not alive', {
						conversationId: this.conversationId,
					}),
				);
			}

			const marker = `---ELEFANT-END-${crypto.randomUUID()}---`;
			const stdoutOffset = this.stdoutBuffer.length;
			const stderrOffset = this.stderrBuffer.length;
			const payload = `${command}\n__elefant_exit_code=$?\necho "${marker}"\necho "${'$'}__elefant_exit_code"\n`;

			this.lastActivity = Date.now();

			try {
				this.stdin.write(payload);
			} catch (error) {
				return err(
					createShellError('TOOL_EXECUTION_FAILED', 'Failed to write command to shell stdin', {
						conversationId: this.conversationId,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			}

			const execution = this.waitForMarker(marker, stdoutOffset, stderrOffset);

			try {
				const result = await runWithTimeout(execution, timeoutMs);
				this.lastActivity = Date.now();
				return ok(result);
			} catch (error) {
				if (error instanceof ShellTimeoutError) {
					await this.close();
					return err(
						createShellError('SHELL_TIMEOUT', error.message, {
							conversationId: this.conversationId,
							timeoutMs,
						}),
					);
				}

				return err(
					createShellError('TOOL_EXECUTION_FAILED', 'Failed during shell command execution', {
						conversationId: this.conversationId,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			}
		};

		const resultPromise = this.executionChain.then(runner, runner);
		this.executionChain = resultPromise.then(
			() => undefined,
			() => undefined,
		);
		return resultPromise;
	}

	public async close(): Promise<void> {
		if (!this.isAlive()) {
			return;
		}

		this.process.kill('SIGTERM');
		await Promise.race([this.process.exited, Bun.sleep(SHUTDOWN_GRACE_MS)]);

		if (this.isAlive()) {
			this.process.kill('SIGKILL');
			await this.process.exited;
		}
	}

	public isAlive(): boolean {
		return !this.hasExited;
	}

	public getLastActivity(): number {
		return this.lastActivity;
	}

	private startPump(stream: ReadableStream<Uint8Array>, channel: 'stdout' | 'stderr'): void {
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		const pump = async (): Promise<void> => {
			try {
				while (true) {
					const chunk = await reader.read();
					if (chunk.done) {
						break;
					}

					const decoded = decoder.decode(chunk.value, { stream: true });
					if (channel === 'stdout') {
						this.stdoutBuffer += decoded;
					} else {
						this.stderrBuffer += decoded;
					}

					this.notifyWaiters();
				}

				const trailing = decoder.decode();
				if (trailing.length > 0) {
					if (channel === 'stdout') {
						this.stdoutBuffer += trailing;
					} else {
						this.stderrBuffer += trailing;
					}
				}
			} catch {
				// Ignore read errors; execute() handles liveness checks and typed errors.
			} finally {
				reader.releaseLock();
				this.notifyWaiters();
			}
		};

		void pump();
	}

	private async waitForMarker(
		marker: string,
		stdoutOffset: number,
		stderrOffset: number,
	): Promise<ShellResult> {
		while (true) {
			const parsed = this.parseStdout(marker, stdoutOffset);
			if (parsed !== null) {
				const stderrChunk = this.stderrBuffer.slice(stderrOffset);
				const result: ShellResult = {
					stdout: normalizeOutput(parsed.stdout),
					stderr: normalizeOutput(stderrChunk),
					exitCode: parsed.exitCode,
				};

				this.stdoutBuffer = this.stdoutBuffer.slice(parsed.consumedUntil);
				this.stderrBuffer = '';
				return result;
			}

			if (!this.isAlive()) {
				throw new Error('Shell process exited before command completion');
			}

			await this.waitForData();
		}
	}

	private parseStdout(marker: string, stdoutOffset: number): ParsedStdout | null {
		const output = this.stdoutBuffer.slice(stdoutOffset);
		const markerIndex = output.indexOf(marker);
		if (markerIndex === -1) {
			return null;
		}

		const markerLineEnd = output.indexOf('\n', markerIndex);
		if (markerLineEnd === -1) {
			return null;
		}

		const exitLineEnd = output.indexOf('\n', markerLineEnd + 1);
		if (exitLineEnd === -1) {
			return null;
		}

		const exitCodeLine = output.slice(markerLineEnd + 1, exitLineEnd).trim();
		const exitCode = Number.parseInt(exitCodeLine, 10);
		if (Number.isNaN(exitCode)) {
			return null;
		}

		return {
			stdout: output.slice(0, markerIndex),
			exitCode,
			consumedUntil: stdoutOffset + exitLineEnd + 1,
		};
	}

	private notifyWaiters(): void {
		for (const waiter of this.waiters) {
			waiter();
		}
		this.waiters.clear();
	}

	private async waitForData(): Promise<void> {
		await new Promise<void>((resolve) => {
			this.waiters.add(resolve);
		});
	}
}

export class ShellSessionManager {
	private readonly sessions = new Map<string, ShellSession>();
	private readonly maxSessions = 5;
	private readonly idleTimeoutMs = 30 * 60 * 1000;

	public getOrCreate(conversationId: string): ShellSession {
		this.pruneIdleSessions();

		const existing = this.sessions.get(conversationId);
		if (existing !== undefined && existing.isAlive()) {
			return existing;
		}

		if (existing !== undefined && !existing.isAlive()) {
			this.sessions.delete(conversationId);
		}

		if (this.sessions.size >= this.maxSessions) {
			this.evictLeastRecentlyActive();
		}

		const session = new ShellSession(conversationId);
		this.sessions.set(conversationId, session);
		return session;
	}

	public async closeAll(): Promise<void> {
		const sessions = Array.from(this.sessions.values());
		this.sessions.clear();
		await Promise.all(sessions.map(async (session) => {
			await session.close();
		}));
	}

	private pruneIdleSessions(): void {
		const now = Date.now();
		for (const [conversationId, session] of this.sessions.entries()) {
			const isIdle = now - session.getLastActivity() > this.idleTimeoutMs;
			if (!session.isAlive() || isIdle) {
				this.sessions.delete(conversationId);
				void session.close();
			}
		}
	}

	private evictLeastRecentlyActive(): void {
		let oldestConversationId: string | null = null;
		let oldestActivity = Number.POSITIVE_INFINITY;

		for (const [conversationId, session] of this.sessions.entries()) {
			const activity = session.getLastActivity();
			if (activity < oldestActivity) {
				oldestActivity = activity;
				oldestConversationId = conversationId;
			}
		}

		if (oldestConversationId !== null) {
			const oldestSession = this.sessions.get(oldestConversationId);
			if (oldestSession !== undefined) {
				this.sessions.delete(oldestConversationId);
				void oldestSession.close();
			}
		}
	}
}

export const sessionManager = new ShellSessionManager();
