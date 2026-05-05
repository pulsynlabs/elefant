import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createInstructionService } from './loader.ts';
import { applyInstructionGuard } from './guard.ts';
import type { InstructionService } from './types.ts';

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-instruction-guard-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

describe('applyInstructionGuard', () => {
	test('1: happy path — new instruction found appends system-reminder', async () => {
		const root = createTempDir();
		const agentsPath = join(root, 'AGENTS.md');
		const childPath = join(root, 'child.txt');

		writeFileSync(agentsPath, 'root instructions');
		writeFileSync(childPath, 'hello');

		const service = createInstructionService(root);
		const alreadyLoaded = new Set<string>();

		const result = await applyInstructionGuard({
			service,
			filepath: childPath,
			alreadyLoaded,
			output: 'tool output',
		});

		expect(result.loaded).toEqual([agentsPath]);
		expect(result.content).toContain('<system-reminder>');
		expect(result.content).toContain('Instructions from:');
		expect(result.content).toContain('root instructions');
	});

	test('2: already loaded — no-op', async () => {
		const root = createTempDir();
		const agentsPath = join(root, 'AGENTS.md');
		const childPath = join(root, 'child.txt');

		writeFileSync(agentsPath, 'root instructions');
		writeFileSync(childPath, 'hello');

		const service = createInstructionService(root);
		const alreadyLoaded = new Set<string>([agentsPath]);

		const result = await applyInstructionGuard({
			service,
			filepath: childPath,
			alreadyLoaded,
			output: 'tool output',
		});

		expect(result.loaded).toEqual([]);
		expect(result.content).toBe('tool output');
	});

	test('3: no instruction file — no-op', async () => {
		const root = createTempDir();
		const childPath = join(root, 'child.txt');
		writeFileSync(childPath, 'hello');

		const service = createInstructionService(root);
		const alreadyLoaded = new Set<string>();

		const result = await applyInstructionGuard({
			service,
			filepath: childPath,
			alreadyLoaded,
			output: 'tool output',
		});

		expect(result.loaded).toEqual([]);
		expect(result.content).toBe('tool output');
	});

	test('4: self-injection prevention — filepath is AGENTS.md', async () => {
		const root = createTempDir();
		const agentsPath = join(root, 'AGENTS.md');
		writeFileSync(agentsPath, 'root instructions');

		const service = createInstructionService(root);
		const alreadyLoaded = new Set<string>();

		const result = await applyInstructionGuard({
			service,
			filepath: agentsPath,
			alreadyLoaded,
			output: 'tool output',
		});

		expect(result.loaded).toEqual([]);
		expect(result.content).toBe('tool output');
	});

	test('5: mutation of alreadyLoaded set', async () => {
		const root = createTempDir();
		const agentsPath = join(root, 'AGENTS.md');
		const childPath = join(root, 'child.txt');

		writeFileSync(agentsPath, 'root instructions');
		writeFileSync(childPath, 'hello');

		const service = createInstructionService(root);
		const alreadyLoaded = new Set<string>();

		await applyInstructionGuard({
			service,
			filepath: childPath,
			alreadyLoaded,
			output: 'tool output',
		});

		expect(alreadyLoaded.has(agentsPath)).toBe(true);
	});

	test('6: multiple levels — root first then leaf', async () => {
		const root = createTempDir();
		const srcDir = join(root, 'src');
		mkdirSync(srcDir, { recursive: true });

		const rootAgents = join(root, 'AGENTS.md');
		const srcAgents = join(srcDir, 'AGENTS.md');
		const target = join(srcDir, 'routes.ts');

		writeFileSync(rootAgents, 'root instructions');
		writeFileSync(srcAgents, 'src instructions');
		writeFileSync(target, 'export const routes = [];');

		const service = createInstructionService(root);
		const alreadyLoaded = new Set<string>();

		const result = await applyInstructionGuard({
			service,
			filepath: target,
			alreadyLoaded,
			output: 'tool output',
		});

		expect(result.loaded).toEqual([rootAgents, srcAgents]);
		const rootIndex = result.content.indexOf('root instructions');
		const srcIndex = result.content.indexOf('src instructions');
		expect(rootIndex).toBeGreaterThan(-1);
		expect(srcIndex).toBeGreaterThan(-1);
		expect(rootIndex).toBeLessThan(srcIndex);
	});

	test('7: error resilience — service throws, output unchanged', async () => {
		const throwingService: InstructionService = {
			resolveRoot: async () => null,
			resolveForFile: async () => {
				throw new Error('boom');
			},
			invalidate: () => {},
			invalidateAll: () => {},
		};

		const alreadyLoaded = new Set<string>();
		const result = await applyInstructionGuard({
			service: throwingService,
			filepath: '/tmp/project/file.ts',
			alreadyLoaded,
			output: 'tool output',
		});

		expect(result.loaded).toEqual([]);
		expect(result.content).toBe('tool output');
	});

	test('8: format check — exact system-reminder wrapper bytes', async () => {
		const root = createTempDir();
		const agentsPath = join(root, 'AGENTS.md');
		const childPath = join(root, 'child.txt');

		writeFileSync(agentsPath, 'root instructions');
		writeFileSync(childPath, 'hello');

		const service = createInstructionService(root);
		const alreadyLoaded = new Set<string>();
		const forExpected = await service.resolveForFile(childPath, new Set<string>());
		const joined = forExpected.map((entry) => entry.content).join('\n\n');

		const result = await applyInstructionGuard({
			service,
			filepath: childPath,
			alreadyLoaded,
			output: 'tool output',
		});

		expect(result.loaded).toHaveLength(1);
		const expected = `tool output\n\n<system-reminder>\n${joined}\n</system-reminder>`;
		expect(result.content).toBe(expected);
	});
});
