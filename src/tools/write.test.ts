/**
 * Tests for the write tool.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeTool } from './write.js';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
