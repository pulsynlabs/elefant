import type { HookRegistry } from '../../hooks/index.ts';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { err, ok } from '../../types/result.js';
import type { ToolDefinition } from '../../types/tools.js';
import { executeEphemeral } from './ephemeral.js';
import { sessionManager } from './session.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface BashParams {
	command: string;
	ephemeral?: boolean;
	timeout?: number;
	cwd?: string;
	conversationId?: string;
}

function createShellError(code: ElefantError['code'], message: string, details?: unknown): ElefantError {
	return {
		code,
		message,
		details,
	};
}

function formatToolOutput(stdout: string, stderr: string, exitCode: number): string {
	let output = stdout;

	if (stderr.length > 0) {
		output = output.length > 0 ? `${output}\n${stderr}` : stderr;
	}

	if (exitCode !== 0) {
		const exitLine = `[Exit code: ${exitCode}]`;
		output = output.length > 0 ? `${output}\n${exitLine}` : exitLine;
	}

	return output;
}

export const bashTool: ToolDefinition<BashParams, string> = {
	name: 'bash',
	description:
		'Execute shell commands. Uses persistent session by default (maintains cwd/env). Set ephemeral: true for isolated execution.',
	parameters: {
		command: {
			type: 'string',
			description: 'The shell command to execute',
			required: true,
		},
		ephemeral: {
			type: 'boolean',
			description: 'Whether to use an isolated one-off shell process',
			required: false,
			default: false,
		},
		timeout: {
			type: 'number',
			description: 'Command timeout in milliseconds',
			required: false,
			default: DEFAULT_TIMEOUT_MS,
		},
		cwd: {
			type: 'string',
			description: 'Working directory for ephemeral mode',
			required: false,
		},
		conversationId: {
			type: 'string',
			description: 'Session key used for persistent shell routing',
			required: false,
			default: 'default',
		},
	},
	execute: async (params): Promise<Result<string, ElefantError>> => {
		const command = params.command.trim();
		if (command.length === 0) {
			return err(createShellError('VALIDATION_ERROR', 'bash command cannot be empty'));
		}

		const timeoutMs = params.timeout ?? DEFAULT_TIMEOUT_MS;

		if (params.ephemeral === true) {
			const result = await executeEphemeral(command, {
				cwd: params.cwd,
				timeoutMs,
			});

			if (!result.ok) {
				return result;
			}

			return ok(formatToolOutput(result.data.stdout, result.data.stderr, result.data.exitCode));
		}

		const conversationId = params.conversationId ?? 'default';

		let sessionResult: Result<string, ElefantError>;
		try {
			const session = sessionManager.getOrCreate(conversationId);
			const executionResult = await session.execute(command, timeoutMs);
			if (!executionResult.ok) {
				sessionResult = err(executionResult.error);
			} else {
				sessionResult = ok(
					formatToolOutput(
						executionResult.data.stdout,
						executionResult.data.stderr,
						executionResult.data.exitCode,
					),
				);
			}
		} catch (error) {
			sessionResult = err(
				createShellError('TOOL_EXECUTION_FAILED', 'Unable to create persistent shell session', {
					conversationId,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}

		return sessionResult;
	},
};

export function registerShellShutdownCleanup(registry: HookRegistry): void {
	registry.register('shutdown', async () => {
		await sessionManager.closeAll();
	});
}

export { sessionManager } from './session.js';
