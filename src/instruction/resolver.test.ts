import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveForFile, resolveRoot } from './resolver.ts';

const tempDirs: string[] = [];

function createTempRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-instruction-resolver-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

describe('instruction resolver', () => {
	test('single-level: resolves AGENTS.md in file parent directory', async () => {
		const root = createTempRoot();
		const srcDir = join(root, 'src');
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, 'AGENTS.md'), 'src instructions');

		const result = await resolveForFile(join(srcDir, 'file.ts'), root, new Set());
		expect(result).toEqual([{ filepath: join(srcDir, 'AGENTS.md') }]);
	});

	test('two-level hierarchy: returns root first then leaf (MH7)', async () => {
		const root = createTempRoot();
		const apiDir = join(root, 'src', 'api');
		mkdirSync(apiDir, { recursive: true });
		writeFileSync(join(root, 'AGENTS.md'), 'root instructions');
		writeFileSync(join(apiDir, 'AGENTS.md'), 'api instructions');

		const result = await resolveForFile(join(apiDir, 'routes.ts'), root, new Set());
		expect(result).toEqual([
			{ filepath: join(root, 'AGENTS.md') },
			{ filepath: join(apiDir, 'AGENTS.md') },
		]);
	});

	test('missing file: returns empty array when no instructions exist', async () => {
		const root = createTempRoot();
		const srcDir = join(root, 'src');
		mkdirSync(srcDir, { recursive: true });

		const result = await resolveForFile(join(srcDir, 'file.ts'), root, new Set());
		expect(result).toEqual([]);
	});

	test('CLAUDE.md fallback: resolves CLAUDE.md when AGENTS.md missing', async () => {
		const root = createTempRoot();
		const srcDir = join(root, 'src');
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, 'CLAUDE.md'), 'claude instructions');

		const result = await resolveForFile(join(srcDir, 'file.ts'), root, new Set());
		expect(result).toEqual([{ filepath: join(srcDir, 'CLAUDE.md') }]);
	});

	test('alreadyLoaded dedup: skips files already loaded in session', async () => {
		const root = createTempRoot();
		const srcDir = join(root, 'src');
		mkdirSync(srcDir, { recursive: true });
		const agentsPath = join(srcDir, 'AGENTS.md');
		writeFileSync(agentsPath, 'src instructions');

		const result = await resolveForFile(join(srcDir, 'file.ts'), root, new Set([agentsPath]));
		expect(result).toEqual([]);
	});

	test('edge case: when filepath is AGENTS.md itself, it is not included', async () => {
		const root = createTempRoot();
		const srcDir = join(root, 'src');
		mkdirSync(srcDir, { recursive: true });
		const agentsPath = join(srcDir, 'AGENTS.md');
		writeFileSync(agentsPath, 'src instructions');

		const result = await resolveForFile(agentsPath, root, new Set());
		expect(result).toEqual([]);
	});

	test('resolveRoot happy path: returns root AGENTS.md', async () => {
		const root = createTempRoot();
		const agentsPath = join(root, 'AGENTS.md');
		writeFileSync(agentsPath, 'root instructions');

		const result = await resolveRoot(root);
		expect(result).toEqual({ filepath: agentsPath });
	});

	test('resolveRoot missing: returns null when no root instruction exists', async () => {
		const root = createTempRoot();

		const result = await resolveRoot(root);
		expect(result).toBeNull();
	});
});
