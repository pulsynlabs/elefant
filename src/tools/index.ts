/**
 * Tool exports for the Elefant agent tool system.
 */

export { readTool, type ReadParams } from './read.js';
export { writeTool, type WriteParams } from './write.js';
export { editTool, type EditParams } from './edit.js';
export { globTool, type GlobParams } from './glob.js';
export {
	bashTool,
	registerShellShutdownCleanup,
	type BashParams,
} from './shell/index.js';
export {
  getRipgrepPath,
  executeBinary,
  type BinaryResult,
} from './binary.js';
export { grepTool, type GrepParams } from './grep.js';
export { ToolRegistry, createToolRegistry, createToolRegistryForRun, type ToolRegistryRunDeps } from './registry.ts';

// New tools (Wave 1-4)
export { applyPatchTool, type ApplyPatchParams } from './apply_patch/index.js';
export { webfetchTool, type WebfetchParams } from './webfetch.js';
export { websearchTool, type WebsearchParams } from './websearch.js';
export {
	todowriteTool,
	todoreadTool,
	type TodoWriteParams,
	type TodoReadParams,
} from './todo/index.js';
export { questionTool, type QuestionParams, type Question, type QuestionOption } from './question/index.js';
export { skillTool, type SkillParams } from './skill/index.js';
export { lspTool, type LspParams, type LspOperation } from './lsp/index.js';
export { createToolListTool, type ToolListParams } from './tool_list/index.js';

// Task and wait_on_run tools (per-run registry only)
export { createTaskTool, type TaskParams, type TaskToolDeps, DEFAULT_MAX_CHILDREN } from './task/index.js';
export { createWaitOnRunTool, type WaitOnRunParams, type WaitOnRunDeps, type WaitOnRunResult } from './wait_on_run/index.js';
