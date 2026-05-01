/**
 * Tool definition types for the Elefant agent tool system.
 */

import type { Result } from './result.js';
import type { ElefantError } from './errors.js';

export interface ToolDefinition<TParams = unknown, TResult = string> {
  name: string;
  description: string;
  /** Optional category for tool inventory generation. Defaults to inference from name when absent. */
  category?: string;
  parameters: Record<string, ParameterDefinition>;
  inputJSONSchema?: unknown;
  execute: (params: TParams) => Promise<Result<TResult, ElefantError>>;
}

export interface ParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string; // Tool output as text for LLM consumption
  isError: boolean;
}
