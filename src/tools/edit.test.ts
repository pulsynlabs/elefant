/**
 * Tests for the edit tool.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { editTool } from './edit.js';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
      expect(result.data).toBe(`Replaced 1 occurrence(s) in ${filePath}`);
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
      expect(result.data).toBe(`Replaced 3 occurrence(s) in ${filePath}`);
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
