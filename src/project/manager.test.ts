import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { access, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectManager } from './manager.ts';
import {
  checkpointsDir,
  dbPath,
  elefantDir,
  logsDir,
  memoryDir,
  pluginsDir,
  statePath,
} from './paths.ts';

/** Check that a path exists (file or directory). */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('ProjectManager.bootstrap', () => {
  let tmpBase: string;
  let projectDir: string;

  beforeAll(async () => {
    tmpBase = await realpath(tmpdir());
    projectDir = join(tmpBase, `elefant-test-${crypto.randomUUID()}`);
    await mkdir(projectDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  test('fresh bootstrap creates all subdirectories', async () => {
    const result = await ProjectManager.bootstrap(projectDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok result');

    const { data } = result;
    expect(data.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(data.projectPath).toBe(projectDir);

    // Verify all directories exist
    expect(await exists(data.elefantDir)).toBe(true);
    expect(await exists(data.logsDir)).toBe(true);
    expect(await exists(data.checkpointsDir)).toBe(true);
    expect(await exists(data.memoryDir)).toBe(true);
    expect(await exists(join(data.elefantDir, 'plugins'))).toBe(true);

    // Verify .project marker file
    const marker = await readFile(
      join(data.elefantDir, '.project'),
      'utf-8',
    );
    expect(marker.trim()).toBe(data.projectId);

    // Verify path fields are consistent
    expect(data.dbPath).toBe(dbPath(projectDir));
    expect(data.statePath).toBe(statePath(projectDir));
    expect(data.elefantDir).toBe(elefantDir(projectDir));
    expect(data.logsDir).toBe(logsDir(projectDir));
    expect(data.checkpointsDir).toBe(checkpointsDir(projectDir));
    expect(data.memoryDir).toBe(memoryDir(projectDir));
  });

  test('repeat bootstrap returns same projectId (idempotent)', async () => {
    const first = await ProjectManager.bootstrap(projectDir);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('Expected ok result');

    const second = await ProjectManager.bootstrap(projectDir);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('Expected ok result');

    expect(second.data.projectId).toBe(first.data.projectId);
    expect(second.data.projectPath).toBe(first.data.projectPath);
  });

  test('projectPath is realpath-resolved', async () => {
    // Create a symlink to the project dir and bootstrap through it
    const linkPath = join(tmpBase, `elefant-link-${crypto.randomUUID()}`);
    try {
      await symlink(projectDir, linkPath);

      const result = await ProjectManager.bootstrap(linkPath);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Expected ok result');

      // The returned projectPath should be the real path, not the symlink
      const realProjectDir = await realpath(projectDir);
      expect(result.data.projectPath).toBe(realProjectDir);
    } finally {
      await rm(linkPath, { force: true });
    }
  });

  test('bootstrap on non-existent nested path creates parent dirs', async () => {
    const nestedDir = join(
      tmpBase,
      `elefant-nested-${crypto.randomUUID()}`,
      'level1',
      'level2',
    );

    const result = await ProjectManager.bootstrap(nestedDir);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok result');

    // Verify the nested directory was created
    expect(await exists(result.data.elefantDir)).toBe(true);
    expect(result.data.projectPath).toBe(await realpath(nestedDir));

    // Clean up
    await rm(result.data.projectPath, { recursive: true, force: true });
  });

  test('bootstrap on non-existent path returns FILE_NOT_FOUND', async () => {
    // Use a path that cannot be created (root-level directory)
    const inaccessible = '/root/elefant-test-impossible';
    const result = await ProjectManager.bootstrap(inaccessible);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected error result');

    expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});
