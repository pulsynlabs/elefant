/**
 * Project-level types for Elefant daemon.
 */

import type { Result } from '../types/result.ts';
import type { ElefantError } from '../types/errors.ts';

export interface ProjectInfo {
  projectId: string;
  projectPath: string;
  elefantDir: string;
  dbPath: string;
  statePath: string;
  logsDir: string;
  checkpointsDir: string;
  memoryDir: string;
}

export type BootstrapResult = Result<ProjectInfo, ElefantError>;
