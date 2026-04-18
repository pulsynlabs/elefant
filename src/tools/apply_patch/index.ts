import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { err, ok } from '../../types/result.js';
import type { ToolDefinition } from '../../types/tools.js';
import { applyPatchOperations } from './applier.js';
import { PatchParseError, parsePatchText } from './parser.js';

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
