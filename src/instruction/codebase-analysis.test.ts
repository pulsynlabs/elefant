import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { analyzeCodebase } from './codebase-analysis.ts';

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-codebase-analysis-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

describe('analyzeCodebase', () => {
	test('extracts high-signal digest for monorepo fixture', async () => {
		const root = createTempDir();

		mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
		mkdirSync(join(root, 'packages', 'core'), { recursive: true });

		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify(
				{
					name: 'test-app',
					scripts: {
						build: 'bun build',
						test: 'bun test',
					},
					workspaces: ['packages/*'],
				},
				null,
				2,
			),
		);
		writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
		writeFileSync(join(root, 'bun.lockb'), '');
		writeFileSync(join(root, 'AGENTS.md'), '# Existing Instructions\nUse tabs.');
		writeFileSync(join(root, 'README.md'), '# Test App\nA test application.');
		writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci');
		writeFileSync(join(root, 'packages', 'core', 'package.json'), '{"name":"@test/core"}');

		const digest = await analyzeCodebase(root);

		expect(digest.manifest?.name).toBe('test-app');
		expect(digest.scripts.build).toBe('bun build');
		expect(digest.scripts.test).toBe('bun test');
		expect(digest.isMonorepo).toBe(true);
		expect(digest.existingInstruction?.content).toContain('Use tabs.');
		expect(digest.configFiles).toContain(join(root, 'tsconfig.json'));
		expect(digest.ciFiles).toContain(join(root, '.github', 'workflows', 'ci.yml'));
		expect(digest.readmeSummary?.startsWith('# Test App')).toBe(true);
		expect(digest.stack.typescript).toBe(true);
		expect(digest.stack.bun).toBe(true);
		expect(digest.stack.hasTests).toBe(true);
		expect(digest.stack.testFramework).toBe('bun');
	});

	test('handles empty project directory gracefully', async () => {
		const root = createTempDir();

		const digest = await analyzeCodebase(root);

		expect(digest.projectRoot).toBe(root);
		expect(digest.manifest).toBeNull();
		expect(digest.scripts).toEqual({});
		expect(digest.isMonorepo).toBe(false);
		expect(digest.monorepoPackages).toEqual([]);
		expect(digest.existingInstruction).toBeNull();
		expect(digest.configFiles).toEqual([]);
		expect(digest.ciFiles).toEqual([]);
		expect(digest.readmeSummary).toBeNull();
		expect(digest.stack.typescript).toBe(false);
		expect(digest.stack.bun).toBe(false);
		expect(digest.stack.hasTests).toBe(false);
		expect(digest.stack.testFramework).toBe('unknown');
	});
});
