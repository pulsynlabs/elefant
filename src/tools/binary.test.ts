import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { executeBinary, getRipgrepPath } from './binary.js';

const TEST_DIR = join(import.meta.dir, 'test-fixtures-binary');

describe('binary utilities', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('getRipgrepPath should return a non-empty path', () => {
    const rgBinaryPath = getRipgrepPath();
    expect(rgBinaryPath.length).toBeGreaterThan(0);
  });

  it('executeBinary should run ripgrep successfully', async () => {
    const filePath = join(TEST_DIR, 'sample.txt');
    await writeFile(filePath, 'alpha\nbeta\ngamma\n', 'utf-8');

    const result = await executeBinary(getRipgrepPath(), ['--json', 'beta', TEST_DIR]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.exitCode).toBe(0);
      expect(result.data.stdout).toContain('"type":"match"');
    }
  });

  it('executeBinary should return BINARY_NOT_FOUND for missing binary', async () => {
    const result = await executeBinary('/path/does/not/exist/rg', ['--version']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BINARY_NOT_FOUND');
    }
  });
});
