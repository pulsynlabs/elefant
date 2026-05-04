import { resolve, basename } from 'node:path';
import { readFile } from 'node:fs/promises';

import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { err, ok } from '../../types/result.js';
import type { ToolDefinition } from '../../types/tools.js';
import { applyPatchOperations } from './applier.js';
import { parsePatchText, PatchParseError, type PatchOperation } from './parser.js';
import { applyInstructionGuard } from '../../instruction/guard.js';
import type { InstructionService } from '../../instruction/types.js';
import { LINE_TARGET } from '../../instruction/types.js';

export interface ApplyPatchParams {
	patchText: string;
}

function formatSummary(summary: { modified: string[]; added: string[]; deleted: string[] }): string {
	const lines: string[] = [
		`Applied patch: ${summary.modified.length} files modified, ${summary.added.length} files added, ${summary.deleted.length} deleted`,
	];

	for (const filePath of summary.modified) {
		lines.push(`- Modified: ${filePath}`);
	}

	for (const filePath of summary.added) {
		lines.push(`- Added: ${filePath}`);
	}

	for (const filePath of summary.deleted) {
		lines.push(`- Deleted: ${filePath}`);
	}

	return lines.join('\n');
}

export const applyPatchTool: ToolDefinition<ApplyPatchParams, string> = {
	name: 'apply_patch',
	description:
		'Apply a multi-file patch with Add/Update/Delete/Move operations atomically. If any operation fails, no files are changed.',
	parameters: {
		patchText: {
			type: 'string',
			description: 'Patch text to parse and apply.',
			required: true,
		},
	},
	execute: async (params): Promise<Result<string, ElefantError>> => {
		if (typeof params.patchText !== 'string' || params.patchText.trim().length === 0) {
			return err({
				code: 'VALIDATION_ERROR',
				message: 'patchText is required and must be a non-empty string',
			});
		}

		try {
			const operations = parsePatchText(params.patchText);
			const applyResult = await applyPatchOperations(operations, process.cwd());
			if (!applyResult.ok) {
				return err(applyResult.error);
			}

			return ok(formatSummary(applyResult.data));
		} catch (error) {
			if (error instanceof PatchParseError) {
				return err({
					code: 'VALIDATION_ERROR',
					message: error.message,
				});
			}

			return err({
				code: 'TOOL_EXECUTION_FAILED',
				message: `Failed to apply patch: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	},
};

export interface ApplyPatchToolDeps {
	/** Instruction service for hierarchical AGENTS.md resolution. */
	service: InstructionService;
	/** Already-loaded instruction paths for this session (mutated by guard). */
	alreadyLoaded: Set<string>;
	/** Absolute project root path. */
	projectRoot: string;
}

/**
 * Extract all unique file paths from patch operations.
 */
function extractFilePaths(operations: PatchOperation[]): string[] {
	const paths = new Set<string>();
	for (const op of operations) {
		paths.add(op.path);
		if (op.type === 'update' && op.moveTo) {
			paths.add(op.moveTo);
		}
	}
	return [...paths];
}

/**
 * Create an apply_patch tool that injects the instruction guard.
 *
 * After a successful patch application, applicable AGENTS.md / CLAUDE.md
 * files in the ancestry of touched files are loaded and appended as a
 * `<system-reminder>` block in the tool output.
 *
 * Simplification: for multi-file patches, the guard runs using only the
 * first file path extracted from the patch operations. The `alreadyLoaded`
 * set deduplicates across operations, so subsequent file touches within
 * the same session/message will still pick up newly-relevant instruction
 * files. A future iteration could run the guard per-file and collect unique
 * instruction blocks across all paths.
 *
 * The underlying `applyPatchTool` is not modified — the factory returns
 * a wrapped copy with the guard injected into the `execute` path.
 */
export function createApplyPatchTool(
	deps: ApplyPatchToolDeps,
): ToolDefinition<ApplyPatchParams, string> {
	return {
		...applyPatchTool,
		execute: async (params): Promise<Result<string, ElefantError>> => {
			// Parse early to extract file paths for the guard before execution.
			// Parsing is cheap (string-splitting, no I/O) so the double-parse in
			// the underlying tool is an acceptable tradeoff for not duplicating
			// apply logic.
			let filePaths: string[] = [];
			try {
				filePaths = extractFilePaths(parsePatchText(params.patchText));
			} catch {
				// If parsing fails, we still call the underlying tool so it can
				// produce a proper parse error. Guard passes through cleanly.
			}

			const base = await applyPatchTool.execute(params);
			if (!base.ok) return base;

			// Use the first file path for the guard; `alreadyLoaded` dedup
			// ensures any instruction file is loaded at most once per session.
			if (filePaths.length === 0) return base;

			const guarded = await applyInstructionGuard({
				service: deps.service,
				filepath: filePaths[0],
				alreadyLoaded: deps.alreadyLoaded,
				output: base.data,
			});

			let output = guarded.content;

			// Invalidate cache + check line count for any instruction file in the patch
			for (const filePath of filePaths) {
				const resolvedPath = resolve(filePath);
				const name = basename(resolvedPath);
				if (name === 'AGENTS.md' || name === 'CLAUDE.md') {
					deps.service.invalidate(resolvedPath);
					try {
						const content = await readFile(resolvedPath, 'utf-8');
						const lineCount = content.split('\n').length;
						if (lineCount > LINE_TARGET) {
							output += `\n\n[WARNING: ${name} has ${lineCount} lines, exceeds target of ${LINE_TARGET}. Consider shortening.]`;
						}
					} catch {
						// read failure must not break the apply_patch tool
					}
				}
			}

			return ok(output);
		},
	};
}
