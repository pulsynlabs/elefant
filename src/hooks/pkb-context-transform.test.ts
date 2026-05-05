import { describe, expect, test } from 'bun:test';

import { createPkbContextTransformHandler } from './pkb-context-transform.ts';
import type { InstructionService, LoadedInstruction } from '../instruction/types.ts';

function createInstructionServiceMock(
	root: LoadedInstruction | null,
): InstructionService {
	return {
		resolveRoot: async () => root,
		resolveForFile: async () => [],
		invalidate: () => {},
		invalidateAll: () => {},
	};
}

describe('createPkbContextTransformHandler', () => {
	test('appends PKB content to system prompt array when file exists', async () => {
		const handler = createPkbContextTransformHandler({
			projectPath: '/tmp/test-project',
			readFile: async () => '## Stack\n- Bun\n- Svelte 5\n',
		});
		const ctx = { system: ['existing'], sessionId: 'sess-1' };
		await handler(ctx);
		expect(ctx.system).toHaveLength(2);
		expect(ctx.system[1]).toContain('Project Knowledge Base');
		expect(ctx.system[1]).toContain('## Stack');
	});

	test('is a no-op when PKB file is absent', async () => {
		const handler = createPkbContextTransformHandler({
			projectPath: '/tmp/test-project',
			readFile: async () => null,
		});
		const ctx = { system: ['existing'], sessionId: 'sess-1' };
		await handler(ctx);
		expect(ctx.system).toEqual(['existing']);
	});

	test('is a no-op when PKB content is whitespace only', async () => {
		const handler = createPkbContextTransformHandler({
			projectPath: '/tmp/test-project',
			readFile: async () => '   \n\t  ',
		});
		const ctx = { system: [], sessionId: 'sess-1' };
		await handler(ctx);
		expect(ctx.system).toEqual([]);
	});

	test('swallows reader errors without throwing', async () => {
		const handler = createPkbContextTransformHandler({
			projectPath: '/tmp/test-project',
			readFile: async () => {
				throw new Error('disk full');
			},
		});
		const ctx = { system: ['x'], sessionId: 'sess-1' };
		await expect(handler(ctx)).resolves.toBeUndefined();
		expect(ctx.system).toEqual(['x']);
	});

	test('reads from .goopspec/PROJECT_KNOWLEDGE_BASE.md path', async () => {
		const seen: string[] = [];
		const handler = createPkbContextTransformHandler({
			projectPath: '/tmp/proj-x',
			readFile: async (path) => {
				seen.push(path);
				return null;
			},
		});
		await handler({ system: [], sessionId: 's' });
		expect(seen[0]).toBe('/tmp/proj-x/.goopspec/PROJECT_KNOWLEDGE_BASE.md');
	});

	test('appends root AGENTS.md instruction content when present', async () => {
		const handler = createPkbContextTransformHandler({
			projectPath: '/tmp/test-project',
			readFile: async () => null,
			instructionService: createInstructionServiceMock({
				filepath: '/tmp/test-project/AGENTS.md',
				content: 'Instructions from: /tmp/test-project/AGENTS.md\n# Repo Rules',
			}),
		});

		const ctx = { system: ['existing'], sessionId: 'sess-1' };
		await handler(ctx);

		expect(ctx.system).toHaveLength(2);
		expect(ctx.system[1]).toContain('Instructions from: /tmp/test-project/AGENTS.md');
		expect(ctx.system[1]).toContain('# Repo Rules');
	});

	test('does not append instruction content when AGENTS.md is missing', async () => {
		const handler = createPkbContextTransformHandler({
			projectPath: '/tmp/test-project',
			readFile: async () => null,
			instructionService: createInstructionServiceMock(null),
		});

		const ctx = { system: ['existing'], sessionId: 'sess-1' };
		await handler(ctx);

		expect(ctx.system).toEqual(['existing']);
	});

	test('appends both PKB and root AGENTS.md content when both are present', async () => {
		const handler = createPkbContextTransformHandler({
			projectPath: '/tmp/test-project',
			readFile: async () => '## Stack\n- Bun\n',
			instructionService: createInstructionServiceMock({
				filepath: '/tmp/test-project/AGENTS.md',
				content: 'Instructions from: /tmp/test-project/AGENTS.md\n# Root Rules',
			}),
		});

		const ctx = { system: ['existing'], sessionId: 'sess-1' };
		await handler(ctx);

		expect(ctx.system).toHaveLength(3);
		expect(ctx.system[1]).toContain('Project Knowledge Base');
		expect(ctx.system[2]).toContain('Instructions from: /tmp/test-project/AGENTS.md');
	});
});
