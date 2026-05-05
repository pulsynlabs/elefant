/**
 * Tests for the edit tool.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { editTool, createEditTool } from './edit.js';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInstructionService } from '../instruction/index.js';
import { LINE_TARGET } from '../instruction/types.js';

const TEST_DIR = join(import.meta.dir, 'test-fixtures-edit');

describe('editTool', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should replace a single occurrence', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Hello, World!', 'utf-8');

    const result = await editTool.execute({
      filePath,
      oldString: 'World',
      newString: 'Universe',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain(`Replaced 1 occurrence(s) in ${filePath}`);
    }

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('Hello, Universe!');
  });

  it('should return error when oldString not found', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Hello, World!', 'utf-8');

    const result = await editTool.execute({
      filePath,
      oldString: 'NonExistent',
      newString: 'Replacement',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toBe('oldString not found in file');
    }
  });

  it('should return error for multiple matches without replaceAll', async () => {
    const filePath = join(TEST_DIR, 'multi.txt');
    await writeFile(filePath, 'foo bar foo baz foo', 'utf-8');

    const result = await editTool.execute({
      filePath,
      oldString: 'foo',
      newString: 'qux',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('Found 3 matches');
      expect(result.error.message).toContain('replaceAll: true');
    }
  });

  it('should replace all occurrences with replaceAll: true', async () => {
    const filePath = join(TEST_DIR, 'multi.txt');
    await writeFile(filePath, 'foo bar foo baz foo', 'utf-8');

    const result = await editTool.execute({
      filePath,
      oldString: 'foo',
      newString: 'qux',
      replaceAll: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain(`Replaced 3 occurrence(s) in ${filePath}`);
    }

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('qux bar qux baz qux');
  });

  it('should return error for missing file', async () => {
    const filePath = join(TEST_DIR, 'notfound.txt');

    const result = await editTool.execute({
      filePath,
      oldString: 'old',
      newString: 'new',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('should handle multiline replacements', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Line 1\nLine 2\nLine 3', 'utf-8');

    const result = await editTool.execute({
      filePath,
      oldString: 'Line 2',
      newString: 'Modified Line 2',
    });

    expect(result.ok).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('Line 1\nModified Line 2\nLine 3');
  });

  it('should handle empty oldString as not found', async () => {
    const filePath = join(TEST_DIR, 'test.txt');
    await writeFile(filePath, 'Hello, World!', 'utf-8');

    const result = await editTool.execute({
      filePath,
      oldString: '',
      newString: 'prefix',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toBe('oldString not found in file');
    }
  });

  it('should replace only first occurrence without replaceAll', async () => {
    const filePath = join(TEST_DIR, 'multi.txt');
    await writeFile(filePath, 'first second first third', 'utf-8');

    // Use a more specific oldString to match only the first occurrence
    const result = await editTool.execute({
      filePath,
      oldString: 'first second',
      newString: 'replaced second',
    });

    expect(result.ok).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('replaced second first third');
  });
});

describe('createEditTool', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should append system-reminder when editing a file in a dir with AGENTS.md', async () => {
    const agentsPath = join(TEST_DIR, 'AGENTS.md');
    const filePath = join(TEST_DIR, 'target.ts');

    await writeFile(agentsPath, 'Always use named exports. Run `bun test` before committing.', 'utf-8');
    await writeFile(filePath, 'export default function foo() {}', 'utf-8');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createEditTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({
      filePath,
      oldString: 'export default function',
      newString: 'export function',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('<system-reminder>');
      expect(result.data).toContain('Always use named exports');
      expect(result.data).toContain('Instructions from:');
      // Verify the edit was actually applied
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('export function foo() {}');
    }
  });

  it('should not append system-reminder when no AGENTS.md exists', async () => {
    const filePath = join(TEST_DIR, 'no-guard.ts');
    await writeFile(filePath, 'export const x = 1;', 'utf-8');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createEditTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({
      filePath,
      oldString: 'export const x = 1;',
      newString: 'export const x = 2;',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toContain('<system-reminder>');
      expect(result.data).toContain('Replaced');
    }
  });

  it('should not modify output on edit error', async () => {
    const filePath = join(TEST_DIR, 'missing.ts');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createEditTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({
      filePath,
      oldString: 'nonexistent',
      newString: 'replacement',
    });

    // Should return error (not crash or produce a guarded success)
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('should invalidate cache when editing AGENTS.md', async () => {
    const agentsPath = join(TEST_DIR, 'AGENTS.md');
    await writeFile(agentsPath, '# Guide v1\n- Rule 1\n- Rule 2', 'utf-8');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createEditTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    // First read via service to populate mtime cache
    const result1 = await service.resolveRoot();
    expect(result1).not.toBeNull();
    expect(result1!.content).toContain('Guide v1');

    // Edit the file
    await tool.execute({
      filePath: agentsPath,
      oldString: 'Guide v1',
      newString: 'Guide v2',
    });

    // After edit + invalidation, resolveRoot should see fresh content
    const result2 = await service.resolveRoot();
    expect(result2).not.toBeNull();
    expect(result2!.content).toContain('Guide v2');
    expect(result2!.content).not.toContain('Guide v1');
  });

  it('should warn when edited AGENTS.md exceeds LINE_TARGET lines', async () => {
    const agentsPath = join(TEST_DIR, 'AGENTS.md');
    // Start with a marker placeholder
    await writeFile(agentsPath, '# AGENTS.md\n## PLACEHOLDER\n', 'utf-8');

    // Build a replacement that pushes it over the limit
    const overLimit = LINE_TARGET;
    const manyLines = Array.from({ length: overLimit }, (_, i) => `- Rule ${i + 1}: do the thing`).join('\n');
    const replacement = `## Expanded Rules\n${manyLines}`;

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createEditTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({
      filePath: agentsPath,
      oldString: '## PLACEHOLDER',
      newString: replacement,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('[WARNING');
      expect(result.data).toContain('exceeds target of');
    }
  });

  it('should not warn when editing a non-instruction file', async () => {
    const filePath = join(TEST_DIR, 'regular.ts');
    await writeFile(filePath, 'export const x = 1;', 'utf-8');

    const service = createInstructionService(resolve(TEST_DIR));
    const alreadyLoaded = new Set<string>();
    const tool = createEditTool({
      service,
      alreadyLoaded,
      projectRoot: resolve(TEST_DIR),
    });

    const result = await tool.execute({
      filePath,
      oldString: 'export const x = 1;',
      newString: 'export const x = 2;',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toContain('[WARNING');
      expect(result.data).not.toContain('exceeds target');
    }
  });
});
