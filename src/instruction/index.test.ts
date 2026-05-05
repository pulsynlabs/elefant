import { describe, expect, test } from 'bun:test';

import type { LoadedInstruction, InstructionService } from './index.ts';
import { INSTRUCTION_FILES, LINE_TARGET, MAX_BYTES } from './index.ts';

describe('instruction module', () => {
	test('LoadedInstruction type is assignable', () => {
		const li: LoadedInstruction = {
			filepath: '/foo/AGENTS.md',
			content: 'hello',
		};
		expect(li.filepath).toBe('/foo/AGENTS.md');
		expect(li.content).toBe('hello');
	});

	test('INSTRUCTION_FILES exports AGENTS.md and CLAUDE.md', () => {
		expect(INSTRUCTION_FILES).toEqual(['AGENTS.md', 'CLAUDE.md']);
	});

	test('MAX_BYTES is 32 KiB', () => {
		expect(MAX_BYTES).toBe(32 * 1024);
	});

	test('LINE_TARGET is 200', () => {
		expect(LINE_TARGET).toBe(200);
	});

	test('InstructionService type exists (compile-time check via satisfies)', () => {
		// Compile-only proof: a mock satisfying InstructionService type-checks.
		const mock: InstructionService = {
			async resolveRoot(): Promise<null> {
				return null;
			},
			async resolveForFile(
				_filepath: string,
				_alreadyLoaded: ReadonlySet<string>,
			) {
				return [];
			},
			invalidate(_absPath: string) {},
			invalidateAll() {},
		};
		expect(mock).toBeDefined();
		expect(typeof mock.resolveRoot).toBe('function');
		expect(typeof mock.invalidateAll).toBe('function');
	});
});
