import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { grepTool } from './grep.js';

const TEST_DIR = join(import.meta.dir, 'test-fixtures-grep');

describe('grepTool', () => {
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

  it('should return file:line:content for matches', async () => {
    await writeFile(join(TEST_DIR, 'app.ts'), 'const token = "abc123";\nconst value = 42;\n', 'utf-8');

    const result = await grepTool.execute({
      pattern: 'token',
      path: TEST_DIR,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('app.ts:1: const token = "abc123";');
    }
  });

  it('should apply include and exclude patterns', async () => {
    await writeFile(join(TEST_DIR, 'include.ts'), 'needle in ts\n', 'utf-8');
    await writeFile(join(TEST_DIR, 'exclude.test.ts'), 'needle in test\n', 'utf-8');

    const result = await grepTool.execute({
      pattern: 'needle',
      path: TEST_DIR,
      include: '*.ts',
      exclude: '*.test.ts',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('include.ts:1: needle in ts');
      expect(result.data).not.toContain('exclude.test.ts');
    }
  });

  it('should return empty string when no matches are found', async () => {
    await writeFile(join(TEST_DIR, 'nomatch.ts'), 'hello world\n', 'utf-8');

    const result = await grepTool.execute({
      pattern: 'pattern-that-does-not-exist',
      path: TEST_DIR,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('');
    }
  });

  it('should return VALIDATION_ERROR for invalid regex', async () => {
    await writeFile(join(TEST_DIR, 'invalid.ts'), 'content\n', 'utf-8');

    const result = await grepTool.execute({
      pattern: '([',
      path: TEST_DIR,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('Invalid regex');
    }
  });
});
