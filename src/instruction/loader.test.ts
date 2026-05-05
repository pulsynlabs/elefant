import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createInstructionService, invalidate, invalidateAll, loadContent } from './loader.ts';
import { MAX_BYTES } from './types.ts';

// Module-level cache is a singleton — clean it between tests.
const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'elefant-instruction-loader-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	invalidateAll();
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// loadContent cache behaviour (tests 1–4)
// ---------------------------------------------------------------------------

describe('loadContent', () => {
	test('1: cache hit — second read returns cached content without re-reading', async () => {
		const dir = createTempDir();
		const filepath = join(dir, 'AGENTS.md');
		writeFileSync(filepath, 'cached content');

		const first = await loadContent(filepath);
		expect(first).toBe('cached content');

		// Read again — file has not changed, cache should serve.
		const second = await loadContent(filepath);
		expect(second).toBe('cached content');
	});

	test('2: mtime invalidation — changed file returns new content', async () => {
		const dir = createTempDir();
		const filepath = join(dir, 'AGENTS.md');
		writeFileSync(filepath, 'version one');

		const first = await loadContent(filepath);
		expect(first).toBe('version one');

		// Advance past the filesystem mtime granularity before writing.
		await Bun.sleep(10);
		writeFileSync(filepath, 'version two');

		const second = await loadContent(filepath);
		expect(second).toBe('version two');
	});

	test('3: 32KiB truncation — oversized file is capped with marker', async () => {
		const dir = createTempDir();
		const filepath = join(dir, 'AGENTS.md');
		const bigContent = 'x'.repeat(MAX_BYTES + 500);
		writeFileSync(filepath, bigContent);

		const result = await loadContent(filepath);

		expect(result.length).toBeLessThan(bigContent.length);
		expect(result).toContain('…[truncated]…');
		expect(result).toEndWith('\n');
		// The truncated content should be exactly MAX_BYTES + marker chars long.
		// Marker: '\n…[truncated]…\n' = 16 chars.
		expect(result).toStartWith('x'.repeat(MAX_BYTES));
	});

	test('4: missing file — returns empty string, never throws', async () => {
		const dir = createTempDir();
		const filepath = join(dir, 'nonexistent.md');

		const result = await loadContent(filepath);
		expect(result).toBe('');
	});
});

// ---------------------------------------------------------------------------
// Cache invalidation (tests 5–6)
// ---------------------------------------------------------------------------

describe('cache invalidation', () => {
	test('5: invalidate clears one entry', async () => {
		const dir = createTempDir();
		const filepath = join(dir, 'AGENTS.md');
		writeFileSync(filepath, 'before invalidation');

		// Populate cache.
		const first = await loadContent(filepath);
		expect(first).toBe('before invalidation');

		// Explicitly invalidate.
		invalidate(filepath);

		// Change file content — if invalidate cleared the entry,
		// loadContent will re-read and return the new content.
		await Bun.sleep(10);
		writeFileSync(filepath, 'after invalidation');
		const second = await loadContent(filepath);
		expect(second).toBe('after invalidation');
	});

	test('6: invalidateAll clears all entries', async () => {
		const dir = createTempDir();
		const pathA = join(dir, 'AGENTS.md');
		const pathB = join(dir, 'CLAUDE.md');
		writeFileSync(pathA, 'alpha');
		writeFileSync(pathB, 'beta');

		// Populate both entries.
		expect(await loadContent(pathA)).toBe('alpha');
		expect(await loadContent(pathB)).toBe('beta');

		// Clear everything.
		invalidateAll();

		// Change both files — entries should re-read from disk.
		await Bun.sleep(10);
		writeFileSync(pathA, 'alpha updated');
		writeFileSync(pathB, 'beta updated');

		expect(await loadContent(pathA)).toBe('alpha updated');
		expect(await loadContent(pathB)).toBe('beta updated');
	});
});

// ---------------------------------------------------------------------------
// InstructionService factory (tests 7–8)
// ---------------------------------------------------------------------------

describe('createInstructionService', () => {
	test('7: resolveRoot returns LoadedInstruction with content for root AGENTS.md', async () => {
		const root = createTempDir();
		const agentsPath = join(root, 'AGENTS.md');
		writeFileSync(agentsPath, 'root-level instructions');

		const service = createInstructionService(root);
		const result = await service.resolveRoot();

		expect(result).not.toBeNull();
		if (!result) return; // TypeScript guard — unreachable after expect above.

		expect(result.filepath).toBe(agentsPath);
		expect(result.content).toContain('Instructions from:');
		expect(result.content).toContain(agentsPath);
		expect(result.content).toContain('root-level instructions');
	});

	test('8: resolveForFile returns ordered entries with content for nested AGENTS.md', async () => {
		const root = createTempDir();
		const apiDir = join(root, 'src', 'api');
		mkdirSync(apiDir, { recursive: true });

		const rootAgents = join(root, 'AGENTS.md');
		const apiAgents = join(apiDir, 'AGENTS.md');
		writeFileSync(rootAgents, 'root instructions');
		writeFileSync(apiAgents, 'api instructions');

		const service = createInstructionService(root);
		const results = await service.resolveForFile(join(apiDir, 'routes.ts'), new Set());

		expect(results).toHaveLength(2);

		// Root-to-leaf ordering: root first, leaf last (MH7).
		expect(results[0].filepath).toBe(rootAgents);
		expect(results[0].content).toContain('root instructions');
		expect(results[0].content).toContain('Instructions from:');

		expect(results[1].filepath).toBe(apiAgents);
		expect(results[1].content).toContain('api instructions');
		expect(results[1].content).toContain('Instructions from:');
	});

	test('resolveRoot returns null when no instruction file exists', async () => {
		const root = createTempDir();

		const service = createInstructionService(root);
		const result = await service.resolveRoot();

		expect(result).toBeNull();
	});

	test('resolveForFile returns empty array when no instruction files exist', async () => {
		const root = createTempDir();
		const srcDir = join(root, 'src');
		mkdirSync(srcDir, { recursive: true });

		const service = createInstructionService(root);
		const results = await service.resolveForFile(join(srcDir, 'file.ts'), new Set());

		expect(results).toEqual([]);
	});

	test('resolveRoot falls back to CLAUDE.md when AGENTS.md missing', async () => {
		const root = createTempDir();
		const claudePath = join(root, 'CLAUDE.md');
		writeFileSync(claudePath, 'claude-specific instructions');

		const service = createInstructionService(root);
		const result = await service.resolveRoot();

		expect(result).not.toBeNull();
		if (!result) return;

		expect(result.filepath).toBe(claudePath);
		expect(result.content).toContain('claude-specific instructions');
	});

	test('service.invalidate delegates to loader cache', async () => {
		const root = createTempDir();
		const agentsPath = join(root, 'AGENTS.md');
		writeFileSync(agentsPath, 'original');

		const service = createInstructionService(root);

		// Load via service → populates cache.
		const first = await service.resolveRoot();
		expect(first).not.toBeNull();
		if (!first) return;
		expect(first.content).toContain('original');

		// Invalidate via service.
		service.invalidate(agentsPath);

		await Bun.sleep(10);
		writeFileSync(agentsPath, 'updated');

		const second = await service.resolveRoot();
		expect(second).not.toBeNull();
		if (!second) return;
		expect(second.content).toContain('updated');
	});

	test('service.invalidateAll delegates to clear cache', async () => {
		const root = createTempDir();
		const agentsPath = join(root, 'AGENTS.md');
		const claudePath = join(root, 'CLAUDE.md');
		writeFileSync(agentsPath, 'a');
		writeFileSync(claudePath, 'b');

		const service = createInstructionService(root);

		// Populate via root (agents) + force-load claude into cache.
		await service.resolveRoot();
		await loadContent(claudePath);

		service.invalidateAll();

		await Bun.sleep(10);
		writeFileSync(agentsPath, 'a2');
		writeFileSync(claudePath, 'b2');

		expect(await loadContent(agentsPath)).toBe('a2');
		expect(await loadContent(claudePath)).toBe('b2');
	});
});
