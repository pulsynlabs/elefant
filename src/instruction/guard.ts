import { resolve } from 'node:path';

import type { InstructionService } from './types.ts';

export interface InstructionGuardInput {
	/** The InstructionService instance (from createInstructionService). */
	service: InstructionService;
	/** Absolute path of the file being read/written. */
	filepath: string;
	/** Already-loaded instruction paths for this session. MUTATED by this function. */
	alreadyLoaded: Set<string>;
	/** The current tool output string to append to. */
	output: string;
}

export interface InstructionGuardResult {
	/** Output string, optionally with <system-reminder> block appended. */
	content: string;
	/** Paths of instruction files that were newly loaded in this call. */
	loaded: string[];
}

function isInstructionFile(filepath: string): boolean {
	const base = filepath.split('/').at(-1) ?? '';
	return base === 'AGENTS.md' || base === 'CLAUDE.md';
}

/**
 * Apply the instruction guard to a tool's output string.
 *
 * If new instruction files are found in the ancestry of `filepath`,
 * appends a <system-reminder> block to the output and records the loaded paths
 * in `alreadyLoaded` (mutation) so they are not re-loaded in the same session.
 *
 * Byte-identical format to OpenCode read.ts:202:
 *   "\n\n<system-reminder>\n${joined}\n</system-reminder>"
 */
export async function applyInstructionGuard(
	input: InstructionGuardInput,
): Promise<InstructionGuardResult> {
	const { service, filepath, alreadyLoaded, output } = input;

	if (isInstructionFile(filepath)) {
		return { content: output, loaded: [] };
	}

	try {
		const resolved = resolve(filepath);
		const instructions = await service.resolveForFile(resolved, alreadyLoaded);

		if (instructions.length === 0) {
			return { content: output, loaded: [] };
		}

		const newly: string[] = [];
		const blocks: string[] = [];

		for (const instr of instructions) {
			if (!alreadyLoaded.has(instr.filepath)) {
				alreadyLoaded.add(instr.filepath);
				newly.push(instr.filepath);
				blocks.push(instr.content);
			}
		}

		if (blocks.length === 0) {
			return { content: output, loaded: [] };
		}

		const joined = blocks.join('\n\n');
		const content = output + `\n\n<system-reminder>\n${joined}\n</system-reminder>`;

		return { content, loaded: newly };
	} catch {
		// Guard failures must never break tool output
		return { content: output, loaded: [] };
	}
}
