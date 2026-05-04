import type { InstallMethod } from './installer.js';

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4;

export interface LspDiagnostic {
  range: LspRange;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: Array<{
    location: { uri: string; range: LspRange };
    message: string;
  }>;
}

export interface Handle {
  process: ReturnType<typeof Bun.spawn>;
  initialization?: Record<string, unknown>;
}

export interface ServerInfo {
  id: string;
  extensions: string[];
  root(filePath: string): Promise<string | undefined>;
  spawn(root: string): Promise<Handle | undefined>;
  /** How to auto-install this server if the binary is not found. */
  install?: InstallMethod;
}
