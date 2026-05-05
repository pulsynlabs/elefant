/**
 * Tests for the read tool.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readTool, createReadTool } from './read.js';
import type { ReadToolDeps } from './read.js';
import { createInstructionService } from '../instruction/index.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const TEST_DIR = join(import.meta.dir, 'test-fixtures');

describe('readTool', () => {
  beforeEach(async () => {
    // Create test directory
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should read a file with line numbers', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Line 1\nLine 2\nLine 3', 'utf-8');

    const result = await readTool.execute({ filePath });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('1: Line 1\n2: Line 2\n3: Line 3');
    }
  });

  it('should handle offset parameter', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5', 'utf-8');

    const result = await readTool.execute({ filePath, offset: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('3: Line 3\n4: Line 4\n5: Line 5');
    }
  });

  it('should handle limit parameter', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5', 'utf-8');

    const result = await readTool.execute({ filePath, limit: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('1: Line 1\n2: Line 2');
    }
  });

  it('should handle offset and limit together', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5', 'utf-8');

    const result = await readTool.execute({ filePath, offset: 2, limit: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('2: Line 2\n3: Line 3');
    }
  });

  it('should return error for missing file', async () => {
    const filePath = join(TEST_DIR, 'nonexistent.txt');

    const result = await readTool.execute({ filePath });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('should list directory entries', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'content', 'utf-8');
    await mkdir(join(TEST_DIR, 'subdir'), { recursive: true });

    const result = await readTool.execute({ filePath: TEST_DIR });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('test.txt');
      expect(result.data).toContain('subdir/');
    }
  });

  it('should detect binary files', async () => {
    const filePath = join(TEST_DIR, 'binary.bin');
    // Create content with >30% non-printable chars
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    await writeFile(filePath, binaryContent);

    const result = await readTool.execute({ filePath });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toBe('Binary file not supported');
    }
  });

  it('should handle empty files', async () => {
    const filePath = join(TEST_DIR, 'empty.txt');
    await writeFile(filePath, '', 'utf-8');

    const result = await readTool.execute({ filePath });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('1: ');
    }
  });

  it('should handle files with trailing newline', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Line 1\nLine 2\n', 'utf-8');

    const result = await readTool.execute({ filePath });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('1: Line 1\n2: Line 2\n3: ');
    }
  });
});

// ─── createReadTool with instruction guard ───────────────────────────────

const INSTR_GUARD_DIR = join(import.meta.dir, 'test-fixtures-instruction-guard');

describe('createReadTool with instruction guard', () => {
  beforeEach(async () => {
    await mkdir(INSTR_GUARD_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(INSTR_GUARD_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  async function makeInstructionGuardDeps(
    projectRoot: string,
    alreadyLoaded?: Set<string>,
  ): Promise<ReadToolDeps> {
    const service = createInstructionService(projectRoot);
    return {
      service,
      alreadyLoaded: alreadyLoaded ?? new Set(),
      projectRoot,
    };
  }

  it('injects system-reminder block when parent directory has AGENTS.md', async () => {
    // ── Arrange ──
    const root = resolve(INSTR_GUARD_DIR, 'fixture-01');
    await mkdir(join(root, 'parent', 'nested'), { recursive: true });

    const agentsContent = '# AGENTS.md\nUse tabs.\n';
    await writeFile(join(root, 'parent', 'AGENTS.md'), agentsContent, 'utf-8');

    const testContent = 'Hello from nested';
    const targetFile = join(root, 'parent', 'nested', 'test.txt');
    await writeFile(targetFile, testContent, 'utf-8');

    const deps = await makeInstructionGuardDeps(root);
    const tool = createReadTool(deps);

    // ── Act ──
    const result = await tool.execute({ filePath: targetFile });

    // ── Assert ──
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Original file content with line numbers should be present
      expect(result.data).toContain('1: Hello from nested');

      // The system-reminder block should be appended
      expect(result.data).toContain('<system-reminder>');
      expect(result.data).toContain('</system-reminder>');

      // The AGENTS.md content should be inside the reminder block
      expect(result.data).toContain('Use tabs.');

      // The Instructions from: prefix (OpenCode convention) should be present
      expect(result.data).toContain('Instructions from:');

      // Verify ordering: original content before system-reminder
      const reminderIdx = result.data.indexOf('<system-reminder>');
      const contentIdx = result.data.indexOf('1: Hello from nested');
      expect(contentIdx).toBeLessThan(reminderIdx);
    }

    // alreadyLoaded should now contain the AGENTS.md path
    const agentsPath = resolve(join(root, 'parent', 'AGENTS.md'));
    expect(deps.alreadyLoaded.has(agentsPath)).toBe(true);
  });

  it('no system-reminder when no AGENTS.md in ancestry', async () => {
    // ── Arrange ──
    const root = resolve(INSTR_GUARD_DIR, 'fixture-02');
    await mkdir(join(root, 'subdir'), { recursive: true });

    const testContent = 'Just a file\n';
    const targetFile = join(root, 'subdir', 'plain.txt');
    await writeFile(targetFile, testContent, 'utf-8');

    const deps = await makeInstructionGuardDeps(root);
    const tool = createReadTool(deps);

    // ── Act ──
    const result = await tool.execute({ filePath: targetFile });

    // ── Assert ──
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('1: Just a file');
      expect(result.data).not.toContain('<system-reminder>');
    }

    // No paths added to alreadyLoaded
    expect(deps.alreadyLoaded.size).toBe(0);
  });

  it('no double-injection when file already in alreadyLoaded', async () => {
    // ── Arrange ──
    const root = resolve(INSTR_GUARD_DIR, 'fixture-03');
    await mkdir(join(root, 'src'), { recursive: true });

    const agentsContent = '# AGENTS.md\nUse spaces.\n';
    const agentsPath = resolve(join(root, 'src', 'AGENTS.md'));
    await writeFile(agentsPath, agentsContent, 'utf-8');

    const testContent = 'File under src';
    const targetFile = join(root, 'src', 'helpers.ts');
    await writeFile(targetFile, testContent, 'utf-8');

    // Pre-seed alreadyLoaded with the AGENTS.md path
    const alreadyLoaded = new Set<string>([agentsPath]);
    const deps = await makeInstructionGuardDeps(root, alreadyLoaded);
    const tool = createReadTool(deps);

    // ── Act ──
    const result = await tool.execute({ filePath: targetFile });

    // ── Assert ──
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('1: File under src');
      expect(result.data).not.toContain('<system-reminder>');
    }

    // alreadyLoaded should still contain exactly the pre-seeded path
    expect(deps.alreadyLoaded.size).toBe(1);
    expect(deps.alreadyLoaded.has(agentsPath)).toBe(true);
  });

  it('preserves read errors without guard modification', async () => {
    // ── Arrange ──
    const root = resolve(INSTR_GUARD_DIR, 'fixture-04');
    await mkdir(root, { recursive: true });

    const deps = await makeInstructionGuardDeps(root);
    const tool = createReadTool(deps);

    // ── Act ──
    const result = await tool.execute({
      filePath: join(root, 'nonexistent.txt'),
    });

    // ── Assert ──
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });
});
