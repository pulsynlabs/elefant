/**
 * Error types for Elefant daemon.
 * All errors use typed codes for programmatic handling.
 */

export type ErrorCode =
  | 'FILE_NOT_FOUND'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_EXECUTION_FAILED'
  | 'PROVIDER_ERROR'
  | 'CONFIG_INVALID'
  | 'SHELL_TIMEOUT'
  | 'BINARY_NOT_FOUND'
  | 'STREAM_ERROR'
  | 'VALIDATION_ERROR'
  | 'INVALID_PHASE'
  | 'TOOL_VETOED';

export interface ElefantError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}
