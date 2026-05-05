/**
 * Tests for the write tool.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeTool, createWriteTool } from './write.js';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInstructionService } from '../instruction/index.js';
import { LINE_TARGET } from '../instruction/types.js';

const TEST_DIR = join(import.meta.dir, 'test-fixtures-write');

describe('writeTool', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should create a new file', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    const content = 'Hello, World!';

    const result = await writeTool.execute({ filePath, content });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Wrote');
      expect(result.data).toContain(filePath);
    }

    // Verify file was created with correct content
    const readContent = await readFile(filePath, 'utf-8');
    expect(readContent).toBe(content);
  });

  it('should overwrite an existing file', async () => {
    const filePath = join(TEST_DIR, 'overwrite.txt');
    const originalContent = 'Original content';
    const newContent = 'New content';

    // Create file with original content
    await writeTool.execute({ filePath, content: originalContent });

    // Overwrite with new content
    const result = await writeTool.execute({ filePath, content: newContent });

    expect(result.ok).toBe(true);

    // Verify content was overwritten
    const readContent = await readFile(filePath, 'utf-8');
    expect(readContent).toBe(newContent);
  });

  it('should create parent directories', async () => {
    const filePath = join(TEST_DIR, 'nested', 'deep', 'file.txt');
    const content = 'Deep nested content';

    const result = await writeTool.execute({ filePath, content });

    expect(result.ok).toBe(true);

    // Verify file was created in nested directory
    const readContent = await readFile(filePath, 'utf-8');
    expect(readContent).toBe(content);
  });

  it('should report correct byte count for unicode content', async () => {
    const filePath = join(TEST_DIR, 'unicode.txt');
    const content = 'Hello, 世界! 🌍'; // Mix of ASCII and multi-byte chars

    const result = await writeTool.execute({ filePath, content });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const expectedBytes = Buffer.byteLength(content, 'utf-8');
      expect(result.data).toContain(`${expectedBytes} bytes`);
    }
  });

  it('should handle empty content', async () => {
    const filePath = join(TEST_DIR, 'empty.txt');
    const content = '';

    const result = await writeTool.execute({ filePath, content });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('0 bytes');
    }

    // Verify file was created and is empty
    const readContent = await readFile(filePath, 'utf-8');
    expect(readContent).toBe('');
  });

  it('should handle multiline content', async () => {
    const filePath = join(TEST_DIR, 'multiline.txt');
    const content = 'Line 1\nLine 2\nLine 3\n';

    const result = await writeTool.execute({ filePath, content });

    expect(result.ok).toBe(true);

    // Verify content
    const readContent = await readFile(filePath, 'utf-8');
    expect(readContent).toBe(content);
  });
});

describe('createWriteTool', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should append system-reminder when writing to a dir with AGENTS.md', async () => {
    const agentsPath = join(TEST_DIR, 'AGENTS.md');
    const filePath = join(TEST_DIR, 'new-file.ts');

    await writeFile(agentsPath, 'Use tabs, not spaces. Tests run with `bun test`.', 'utf-8');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createWriteTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({ filePath, content: 'export const foo = 1;' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('<system-reminder>');
      expect(result.data).toContain('Use tabs, not spaces');
      expect(result.data).toContain('Instructions from:');
      // Verify file was actually written
      const readContent = await readFile(filePath, 'utf-8');
      expect(readContent).toBe('export const foo = 1;');
    }
  });

  it('should not append system-reminder when no AGENTS.md exists', async () => {
    const filePath = join(TEST_DIR, 'no-guard-file.ts');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createWriteTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({ filePath, content: 'export const bar = 2;' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toContain('<system-reminder>');
      expect(result.data).toContain('Wrote');
    }
  });

  it('should not modify output on write error', async () => {
    // Use a path that will fail (e.g., inside a non-writable directory).
    // We simulate this with an invalid path that can't have parent dirs created.
    const filePath = '/dev/null/nested/fail.txt';

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createWriteTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({ filePath, content: 'data' });

    // Should return error (not crash or produce a guarded success)
    expect(result.ok).toBe(false);
  });

  it('should invalidate cache when writing AGENTS.md', async () => {
    const agentsPath = join(TEST_DIR, 'AGENTS.md');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createWriteTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    // First write: cache gets populated
    await tool.execute({ filePath: agentsPath, content: '# Guide v1\n- Rule 1\n- Rule 2' });

    // Read via service to populate mtime cache
    const result1 = await service.resolveRoot();
    expect(result1).not.toBeNull();
    expect(result1!.content).toContain('Guide v1');

    // Second write: should invalidate cache so resolveRoot sees fresh content
    // Small sleep ensures tmpfs mtime advances past the cached value
    await Bun.sleep(15);
    await tool.execute({ filePath: agentsPath, content: '# Guide v2\n- Rule A\n- Rule B' });

    const result2 = await service.resolveRoot();
    expect(result2).not.toBeNull();
    expect(result2!.content).toContain('Guide v2');
    expect(result2!.content).not.toContain('Guide v1');
  });

  it('should warn when AGENTS.md exceeds LINE_TARGET lines', async () => {
    const agentsPath = join(TEST_DIR, 'AGENTS.md');
    const overLimit = LINE_TARGET + 10;
    const lines = Array.from({ length: overLimit }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createWriteTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({ filePath: agentsPath, content });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('[WARNING');
      expect(result.data).toContain(`has ${overLimit} lines`);
      expect(result.data).toContain(`target of ${LINE_TARGET}`);
    }
  });

  it('should not warn when AGENTS.md is within LINE_TARGET', async () => {
    const agentsPath = join(TEST_DIR, 'AGENTS.md');
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createWriteTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({ filePath: agentsPath, content });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toContain('[WARNING');
      expect(result.data).toContain('Wrote');
    }
  });

  it('should not warn or invalidate when writing a non-instruction file', async () => {
    const filePath = join(TEST_DIR, 'regular-file.ts');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createWriteTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({ filePath, content: 'export const foo = 1;' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toContain('[WARNING');
      // Should not have line count warning in output
      expect(result.data).not.toContain('exceeds target');
    }
  });
});
