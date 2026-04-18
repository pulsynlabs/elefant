/**
 * ProjectManager — creates and maintains the .elefant/ per-project directory.
 *
 * Bootstrap is idempotent: re-running on an existing project returns the same
 * projectId without modifying any files.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { err, ok } from '../types/result.ts';
import type { BootstrapResult, ProjectInfo } from './types.ts';
import {
  checkpointsDir,
  dbPath,
  elefantDir,
  logsDir,
  memoryDir,
  pluginsDir,
  statePath,
} from './paths.ts';

const PROJECT_MARKER = '.project';

export class ProjectManager {
  /**
   * Bootstrap a project directory.
   *
   * Creates `.elefant/` with all subdirectories if they do not exist.
   * Generates a stable UUID on first run, persisted in `.elefant/.project`.
   * On re-run, reads the existing UUID — fully idempotent.
   *
   * @param projectPath — absolute or relative path to the project root
   * @returns Result with ProjectInfo on success, ElefantError on failure
   */
  static async bootstrap(projectPath: string): Promise<BootstrapResult> {
    let resolved: string;

    try {
      resolved = await realpath(projectPath);
    } catch {
      // Path may not exist yet — create it, then resolve
      try {
        await mkdir(projectPath, { recursive: true });
        resolved = await realpath(projectPath);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return err({
          code: 'PERMISSION_DENIED',
          message: `Cannot create or resolve project path: ${projectPath}`,
          details: { original: message },
        });
      }
    }

    const eDir = elefantDir(resolved);
    const subdirs = [
      eDir,
      logsDir(resolved),
      checkpointsDir(resolved),
      memoryDir(resolved),
      pluginsDir(resolved),
    ];

    try {
      for (const dir of subdirs) {
        await mkdir(dir, { recursive: true });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return err({
        code: 'PERMISSION_DENIED',
        message: `Failed to create .elefant/ directory structure at ${resolved}`,
        details: { original: message },
      });
    }

    const markerPath = `${eDir}/${PROJECT_MARKER}`;
    let projectId: string;

    try {
      const existing = await readFile(markerPath, 'utf-8');
      projectId = existing.trim();
    } catch {
      // First bootstrap — generate and persist UUID
      projectId = randomUUID();
      try {
        await writeFile(markerPath, `${projectId}\n`, 'utf-8');
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : String(cause);
        return err({
          code: 'PERMISSION_DENIED',
          message: `Failed to write project marker at ${markerPath}`,
          details: { original: message },
        });
      }
    }

    const info: ProjectInfo = {
      projectId,
      projectPath: resolved,
      elefantDir: eDir,
      dbPath: dbPath(resolved),
      statePath: statePath(resolved),
      logsDir: logsDir(resolved),
      checkpointsDir: checkpointsDir(resolved),
      memoryDir: memoryDir(resolved),
    };

    return ok(info);
  }
}
