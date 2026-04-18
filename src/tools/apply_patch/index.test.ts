import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPatchTool } from './index.js';

describe('applyPatchTool', () => {
	let testRoot: string;
	let originalCwd: string;

	beforeEach(() => {
		originalCwd = process.cwd();
		testRoot = mkdtempSync(join(tmpdir(), 'elefant-apply-patch-test-'));
		mkdirSync(join(testRoot, 'src'), { recursive: true });
		process.chdir(testRoot);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(testRoot, { recursive: true, force: true });
	});

	it('creates a new file from add operation', async () => {
		const patchText = ['*** Add File: src/new-file.ts', '+export const hello = "world";', '+'].join('\n');

		const result = await applyPatchTool.execute({ patchText });
		expect(result.ok).toBe(true);

		const createdPath = join(testRoot, 'src/new-file.ts');
		expect(existsSync(createdPath)).toBe(true);
		expect(readFileSync(createdPath, 'utf-8')).toBe('export const hello = "world";\n');
	});

	it('applies a single update hunk', async () => {
		const target = join(testRoot, 'src/existing.ts');
		writeFileSync(target, 'const OLD = true;\nexport const value = 1;\n', 'utf-8');

		const patchText = [
			'*** Update File: src/existing.ts',
			'@@',
			'-const OLD = true;',
			'+const NEW = false;',
			' export const value = 1;',
		].join('\n');

		const result = await applyPatchTool.execute({ patchText });
		expect(result.ok).toBe(true);
		expect(readFileSync(target, 'utf-8')).toBe('const NEW = false;\nexport const value = 1;\n');
	});

	it('deletes an existing file', async () => {
		const target = join(testRoot, 'src/obsolete.ts');
		writeFileSync(target, 'legacy', 'utf-8');

		const patchText = '*** Delete File: src/obsolete.ts';
		const result = await applyPatchTool.execute({ patchText });

		expect(result.ok).toBe(true);
		expect(existsSync(target)).toBe(false);
	});

	it('renames a file after update using move marker', async () => {
		const source = join(testRoot, 'src/old.ts');
		const destination = join(testRoot, 'src/new.ts');
		writeFileSync(source, 'const OLD = true;\n', 'utf-8');

		const patchText = [
			'*** Update File: src/old.ts',
			'*** Move to: src/new.ts',
			'@@',
			'-const OLD = true;',
			'+const NEW = false;',
		].join('\n');

		const result = await applyPatchTool.execute({ patchText });

		expect(result.ok).toBe(true);
		expect(existsSync(source)).toBe(false);
		expect(existsSync(destination)).toBe(true);
		expect(readFileSync(destination, 'utf-8')).toBe('const NEW = false;\n');
	});

	it('applies multi-operation patch atomically when all operations are valid', async () => {
		const updateTarget = join(testRoot, 'src/existing.ts');
		const deleteTarget = join(testRoot, 'src/obsolete.ts');
		writeFileSync(updateTarget, 'const OLD = true;\n', 'utf-8');
		writeFileSync(deleteTarget, 'legacy', 'utf-8');

		const patchText = [
			'*** Add File: src/new.ts',
			'+export const created = true;',
			'*** Update File: src/existing.ts',
			'@@',
			'-const OLD = true;',
			'+const NEW = false;',
			'*** Delete File: src/obsolete.ts',
		].join('\n');

		const result = await applyPatchTool.execute({ patchText });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('Applied patch: 1 files modified, 1 files added, 1 deleted');
		}

		expect(readFileSync(join(testRoot, 'src/new.ts'), 'utf-8')).toBe('export const created = true;');
		expect(readFileSync(updateTarget, 'utf-8')).toBe('const NEW = false;\n');
		expect(existsSync(deleteTarget)).toBe(false);
	});

	it('returns validation error for malformed patch text', async () => {
		const result = await applyPatchTool.execute({ patchText: '@@\n-no marker' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
		}
	});

	it('returns file not found for update on missing file', async () => {
		const patchText = ['*** Update File: src/missing.ts', '@@', '-old', '+new'].join('\n');

		const result = await applyPatchTool.execute({ patchText });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('FILE_NOT_FOUND');
		}
	});

	it('returns file not found for delete on missing file', async () => {
		const result = await applyPatchTool.execute({ patchText: '*** Delete File: src/missing.ts' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('FILE_NOT_FOUND');
		}
	});

	it('returns permission denied for path escape attempts', async () => {
		const patchText = ['*** Add File: ../../etc/passwd', '+insecure'].join('\n');

		const result = await applyPatchTool.execute({ patchText });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('PERMISSION_DENIED');
		}
	});

	it('does not write files when one operation fails mid-patch', async () => {
		const stable = join(testRoot, 'src/stable.ts');
		writeFileSync(stable, 'stable', 'utf-8');

		const patchText = [
			'*** Add File: src/should-not-exist.ts',
			'+export const unsafe = true;',
			'*** Update File: src/missing.ts',
			'@@',
			'-old',
			'+new',
		].join('\n');

		const result = await applyPatchTool.execute({ patchText });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('FILE_NOT_FOUND');
		}

		expect(existsSync(join(testRoot, 'src/should-not-exist.ts'))).toBe(false);
		expect(readFileSync(stable, 'utf-8')).toBe('stable');
	});
});
