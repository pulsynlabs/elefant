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
  /**
   * Restrict tool execution to specific agent types. When set, the registry
   * checks the calling agent's type against this list before invoking
   * execute(). If the agent is not allowed, PERMISSION_DENIED is returned
   * before the tool's own execute() runs.
   *
   * Tools that handle their own permission checks internally (e.g.
   * research_write) SHOULD also set this field as a belt-and-suspenders
   * guard at the registry boundary.
   */
  allowedAgents?: string[];
  /**
   * When true, this tool's full schema is always included in the initial API
   * tool array, even if deferred mode is active. Use to ensure critical tools
   * are never withheld.
   */
  alwaysLoad?: boolean;
  /**
   * When true, this tool's full schema is withheld from the initial API tool
   * array. It appears only as a compact marker in the tool inventory. Use
   * `tool_search` to discover and promote the full schema. Overridden by
   * alwaysLoad: true.
   */
  deferred?: boolean;
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
