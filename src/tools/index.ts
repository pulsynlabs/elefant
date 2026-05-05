/**
 * Tool exports for the Elefant agent tool system.
 */

export { readTool, createReadTool, type ReadParams, type ReadToolDeps } from './read.js';
export { writeTool, createWriteTool, type WriteParams, type WriteToolDeps } from './write.js';
export { editTool, createEditTool, type EditParams, type EditToolDeps } from './edit.js';
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
export { applyPatchTool, createApplyPatchTool, type ApplyPatchParams, type ApplyPatchToolDeps } from './apply_patch/index.js';
export { webfetchTool, type WebfetchParams } from './webfetch.js';
export { websearchTool, type WebsearchParams } from './websearch.js';
export {
	todowriteTool,
	todoreadTool,
	type TodoWriteParams,
	type TodoReadParams,
} from './todo/index.js';
export { questionTool, type QuestionParams, type Question, type QuestionOption } from './question/index.js';
export { skillTool, createSkillTool, initializeSkillTool, type SkillParams } from './skill/index.js';
export { lspTool, type LspParams, type LspOperation } from './lsp/index.js';
export { createToolListTool, type ToolListParams } from './tool_list/index.js';
export { createToolSearchTool, type ToolSearchParams, type ToolSearchDeps, type SkillCatalogEntry } from './tool_search/index.js';

// Task and agent_session_search tools (per-run registry only)
export { createTaskTool, type TaskParams, type TaskToolDeps, DEFAULT_MAX_CHILDREN } from './task/index.js';
export { createAgentSessionSearchTool, type AgentSessionSearchParams, type AgentSessionSearchDeps } from './agent_session_search/index.js';

// Visualization tool (Wave 5 - agent rich viz)
export { createVisualizeTool, type VisualizeParams, type VisualizeToolDeps } from './visualize/index.js';
