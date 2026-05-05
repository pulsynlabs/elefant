import type { ConfigManager } from '../config/loader.js';
import type { Database } from '../db/database.ts';
import { emit, type HookRegistry } from '../hooks/index.ts';
import type { ProviderRouter } from '../providers/router.ts';
import type { RunRegistry } from '../runs/registry.ts';
import type { RunContext } from '../runs/types.ts';
import type { MCPManager } from '../mcp/manager.ts';
import { createMcpSearchToolsTool } from '../mcp/meta-tools.ts';
import { createDisabledProvider } from '../fieldnotes/embeddings/disabled.js';
import { FieldNotesStore } from '../fieldnotes/store.ts';
import type { ElefantError } from '../types/errors.ts';
import { err, ok, type Result } from '../types/result.ts';
import type { ParameterDefinition, ToolDefinition, ToolResult } from '../types/tools.ts';
import type { InstructionService } from '../instruction/index.js';
import type { SseManager } from '../transport/sse-manager.js';
import { applyPatchTool, createApplyPatchTool } from './apply_patch/index.js';
import { createAgentSessionSearchTool, type AgentSessionSearchDeps } from './agent_session_search/index.js';
import { editTool, createEditTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { lspTool } from './lsp/index.js';
import { lspDiagnosticsTool } from './lsp_diagnostics/index.js';
import { createInteractiveTools } from './interactive/index.js';
import { readTool, createReadTool } from './read.js';
import { bashTool } from './shell/index.js';
import { skillTool } from './skill/index.js';
import { referenceTool } from './reference/index.js';
import { createSpecToolContext, createSpecTools } from './workflow/index.ts';
import { createTaskTool, type TaskToolDeps } from './task/index.js';
import type { MetadataEmitter } from './task/metadata-emitter.js';
import { todoreadTool, todowriteTool } from './todo/index.js';
import { createToolListTool } from './tool_list/index.js';
import { createToolSearchTool, type SkillCatalogEntry } from './tool_search/index.js';
import { webfetchTool } from './webfetch.js';
import { websearchTool } from './websearch.js';
import { getDatetimeTool } from './get_datetime/index.js';
import { writeTool, createWriteTool } from './write.js';
import { createFieldNotesSearchTool } from './field_notes_search/index.js';
import { fieldNotesGrepTool } from './field_notes_grep/index.js';
import { createFieldNotesReadTool } from './field_notes_read/index.js';
import { fieldNotesWriteTool } from './field_notes_write/index.js';
import { createFieldNotesIndexTool } from './field_notes_index/index.js';
import { createVisualizeTool } from './visualize/index.js';

export const MAX_TOOL_OUTPUT_CHARS = 100_000;

function createStaticRunContext(): RunContext {
	return {
		runId: 'static-tool-registry',
		depth: 0,
		agentType: 'system',
		title: 'static-tool-registry',
		sessionId: 'static-tool-registry',
		projectId: 'static-tool-registry',
		signal: new AbortController().signal,
		discoveredTools: new Set<string>(),
	};
}

function extractSkillCatalogFromRegistry(registry: ToolRegistry): SkillCatalogEntry[] {
	const skillResult = registry.get('skill');
	if (!skillResult.ok) {
		return [];
	}

	const description = skillResult.data.description;
	const matches = Array.from(description.matchAll(/- \*\*(.+?)\*\*: (.+?) \(call skill\('\1'\) to load full content\)/g));
	return matches.map((match) => ({
		name: match[1]!.trim(),
		summary: match[2]!.trim(),
	}));
}

const TRUNCATION_NOTICE_TEMPLATE = (n: number): string =>
	`\n\n[Output truncated: showing first ${n} chars. Use grep/glob/read to retrieve specific parts.]`;

function createToolError(message: string, details?: unknown): ElefantError {
	return {
		code: 'TOOL_EXECUTION_FAILED',
		message,
		details,
	};
}

function toHookArgs(args: unknown): Record<string, unknown> {
	if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}

	return {};
}

function toConversationId(args: Record<string, unknown>): string {
	const candidate = args.conversationId;
	return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'default';
}

function toToolContent(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function truncateToolOutput(args: {
	content: string;
	maxChars?: number;
	maxLines?: number;
}): { content: string; wasTruncated: boolean } {
	const maxChars = args.maxChars ?? MAX_TOOL_OUTPUT_CHARS;
	let content = args.content;
	let wasTruncated = false;

	if (args.maxLines !== undefined) {
		const lines = content.split('\n');
		if (lines.length > args.maxLines) {
			content = lines.slice(0, args.maxLines).join('\n');
			wasTruncated = true;
		}
	}

	if (content.length > maxChars) {
		content = content.slice(0, maxChars);
		wasTruncated = true;
	}

	if (!wasTruncated) {
		return { content, wasTruncated: false };
	}

	return {
		content: content + TRUNCATION_NOTICE_TEMPLATE(maxChars),
		wasTruncated: true,
	};
}

function toHookResult(content: string, isError: boolean): ToolResult {
	return {
		toolCallId: '',
		content,
		isError,
	};
}

function actualType(value: unknown): string {
	if (value === null) {
		return 'null';
	}

	if (Array.isArray(value)) {
		return 'array';
	}

	return typeof value;
}

function matchesParameterType(value: unknown, type: ParameterDefinition['type']): boolean {
	switch (type) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && !Number.isNaN(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'object':
			return typeof value === 'object' && value !== null && !Array.isArray(value);
		case 'array':
			return Array.isArray(value);
	}
}

function createValidationError(toolName: string, reason: string): ElefantError {
	return {
		code: 'VALIDATION_ERROR',
		message: `The "${toolName}" tool was called with invalid arguments: ${reason}. Please rewrite the input so it satisfies the expected schema.`,
	};
}

export function validateToolArgs(
	tool: ToolDefinition<unknown, string>,
	rawArgs: unknown,
): Result<Record<string, unknown>, ElefantError> {
	if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
		return err(createValidationError(tool.name, `expected an object, got ${actualType(rawArgs)}`));
	}

	const validatedArgs: Record<string, unknown> = { ...(rawArgs as Record<string, unknown>) };

	for (const [paramName, definition] of Object.entries(tool.parameters)) {
		const valueIsPresent = paramName in validatedArgs;
		if (!valueIsPresent) {
			if (definition.default !== undefined) {
				validatedArgs[paramName] = definition.default;
				continue;
			}

			if (definition.required) {
				return err(createValidationError(tool.name, `missing required field "${paramName}" (${definition.type})`));
			}

			continue;
		}

		if (!matchesParameterType(validatedArgs[paramName], definition.type)) {
			return err(createValidationError(
				tool.name,
				`field "${paramName}" expected ${definition.type}, got ${actualType(validatedArgs[paramName])}`,
			));
		}
	}

	return ok(validatedArgs);
}

export class ToolRegistry {
	private readonly tools: Map<string, ToolDefinition<unknown, string>>;
	private readonly hookRegistry: HookRegistry;
	private currentAgentName?: string;

	public constructor(hookRegistry: HookRegistry) {
		this.tools = new Map<string, ToolDefinition<unknown, string>>();
		this.hookRegistry = hookRegistry;
	}

	/**
	 * Set the calling agent name for this registry instance. When set, the
	 * registry enforces per-tool `allowedAgents` at the execute() boundary
	 * before the tool's own execute() runs.
	 */
	public setCurrentAgentName(name: string): void {
		this.currentAgentName = name;
	}

	public register<TParams, TResult>(tool: ToolDefinition<TParams, TResult>): void {
		const normalized: ToolDefinition<unknown, string> = {
			name: tool.name,
			description: tool.description,
			category: tool.category,
			parameters: tool.parameters,
			inputJSONSchema: tool.inputJSONSchema,
			allowedAgents: tool.allowedAgents,
			execute: async (params): Promise<Result<string, ElefantError>> => {
				const result = await tool.execute(params as TParams)
				if (!result.ok) {
					return result
				}

				return ok(toToolContent(result.data))
			},
		}

		this.tools.set(tool.name, normalized);
	}

	public get(name: string): Result<ToolDefinition<unknown, string>, ElefantError> {
		const tool = this.tools.get(name);
		if (!tool) {
			return err({
				code: 'TOOL_NOT_FOUND',
				message: `Tool not found: ${name}`,
			});
		}

		return ok(tool);
	}

	public async execute(name: string, args: unknown): Promise<Result<string, ElefantError>> {
		const toolResult = this.get(name);
		if (!toolResult.ok) {
			return toolResult;
		}

		const tool = toolResult.data;

		// Belt-and-suspenders: if the tool declares an allowed-agents list and
		// the registry knows the calling agent, reject disallowed callers before
		// hooks, validation, or tool execution run.
		if (tool.allowedAgents && tool.allowedAgents.length > 0 && this.currentAgentName) {
			if (!tool.allowedAgents.includes(this.currentAgentName)) {
				return err({
					code: 'PERMISSION_DENIED',
					message: `Tool "${name}" is restricted to agents: ${tool.allowedAgents.join(', ')} (called by ${this.currentAgentName}).`,
				});
			}
		}

		const hookArgs = toHookArgs(args);
		const conversationId = toConversationId(hookArgs);
		const startedAt = Date.now();

		const beforeContext = await emit(this.hookRegistry, 'tool:before', {
			toolName: name,
			args: hookArgs,
			conversationId,
		});
		if (beforeContext.veto === true) {
			const errorPayload = beforeContext.error ?? {
				code: 'TOOL_VETOED',
				message: `Tool '${name}' was vetoed by a before hook`,
			};
			const message = errorPayload.message;
			const code = errorPayload.code === 'INVALID_PHASE'
				? 'INVALID_PHASE'
				: errorPayload.code === 'TOOL_VETOED'
					? 'TOOL_VETOED'
					: 'TOOL_EXECUTION_FAILED';
			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(message, true),
				durationMs: Date.now() - startedAt,
				conversationId,
			});
			return err({
				code,
				message,
				details: errorPayload,
			});
		}

		const validatedArgs = validateToolArgs(tool, args);
		if (!validatedArgs.ok) {
			const truncated = truncateToolOutput({ content: validatedArgs.error.message });
			const error = {
				...validatedArgs.error,
				message: truncated.content,
			};

			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(truncated.content, true),
				durationMs: Date.now() - startedAt,
				conversationId,
			});

			return err(error);
		}

		try {
			const execution = await tool.execute(validatedArgs.data);
			if (!execution.ok) {
				const truncated = truncateToolOutput({ content: execution.error.message });
				const error = {
					...execution.error,
					message: truncated.content,
				};

				await emit(this.hookRegistry, 'tool:after', {
					toolName: name,
					args: hookArgs,
					result: toHookResult(truncated.content, true),
					durationMs: Date.now() - startedAt,
					conversationId,
				});

				return err(error);
			}

			const content = toToolContent(execution.data);
			const truncated = truncateToolOutput({ content });
			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(truncated.content, false),
				durationMs: Date.now() - startedAt,
				conversationId,
			});

			return ok(truncated.content);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stack = error instanceof Error ? error.stack : undefined;
			const wrappedMessage = `Tool "${name}" threw an exception: ${message}`;
			const truncated = truncateToolOutput({ content: wrappedMessage });
			// Log the full error so operators can diagnose tool crashes. The
			// registry rewrites the thrown error into a flat `{ ok: false, error }`
			// Result below (so the agent loop can continue), which hides the stack
			// from the SSE client. The stderr log is the only place to see it.
			console.error(`[registry] Tool "${name}" threw:`, error);
			await emit(this.hookRegistry, 'tool:after', {
				toolName: name,
				args: hookArgs,
				result: toHookResult(truncated.content, true),
				durationMs: Date.now() - startedAt,
				conversationId,
			});

			return err(createToolError(truncated.content, { message, stack }));
		}
	}

	public getAll(): ToolDefinition[] {
		return Array.from(this.tools.values());
	}
}

/**
 * Filter a tool list to only include tools accessible to a given agent type.
 *
 * A tool is accessible when:
 * - It has no `allowedAgents` restriction (public to all agents), OR
 * - The agent's type is explicitly listed in `allowedAgents`.
 *
 * This mirrors the runtime enforcement in `ToolRegistry.execute()` (line 251–258)
 * but operates on the static tool definitions so the LLM never sees tools it
 * cannot call. The execute()-level check remains as a belt-and-suspenders guard.
 */
export function filterToolsForAgent(
	tools: ToolDefinition[],
	agentType: string,
): ToolDefinition[] {
	return tools.filter((tool) => {
		if (!tool.allowedAgents || tool.allowedAgents.length === 0) {
			return true
		}

		return tool.allowedAgents.includes(agentType)
	})
}

/**
 * Resolve a project's absolute filesystem path from the daemon database.
 * Used by createToolRegistryForRun to provide projectPath to research tools.
 */
function resolveProjectPath(database: Database, projectId: string): string {
	const row = database.db
		.query('SELECT path FROM projects WHERE id = ?')
		.get(projectId) as { path: string } | undefined;
	return row?.path ?? process.cwd();
}

export function createToolRegistry(hookRegistry: HookRegistry): ToolRegistry {
	const registry = new ToolRegistry(hookRegistry);
	registry.register(readTool);
	registry.register(writeTool);
	registry.register(editTool);
	registry.register(globTool);
	registry.register(grepTool);
	registry.register(bashTool);
	registry.register(applyPatchTool);
	registry.register(webfetchTool);
	registry.register(websearchTool);
	registry.register(getDatetimeTool);
	registry.register(todowriteTool);
	registry.register(todoreadTool);
	// Interactive tools (always registered regardless of session mode)
	for (const tool of createInteractiveTools({})) {
		registry.register(tool);
	}
	registry.register(skillTool);
	registry.register(createToolSearchTool({
		registry,
		runContext: createStaticRunContext(),
		skillCatalog: extractSkillCatalogFromRegistry(registry),
	}));
	registry.register(referenceTool);
	registry.register(lspTool);
	registry.register(lspDiagnosticsTool);
	const visualizeTool = createVisualizeTool();
	registry.register(visualizeTool);
	// Field Notes tools — read-only tools available to all agents.
	// See reference: field-notes-workflow (auto-loaded for researcher/writer agents).
	registry.register(fieldNotesGrepTool);
	registry.register(fieldNotesWriteTool);
	registry.register(createFieldNotesReadTool({ projectPath: process.cwd() }));
	registry.register(createFieldNotesSearchTool({ embeddingProvider: createDisabledProvider() }));
	registry.register(createFieldNotesIndexTool({
		listDocuments: () => ok([]),
	}));
	// tool_list is registered last so it reflects the complete set, including
	// any tools registered above it. Plugins that register tools after startup
	// are also included since the factory closes over the live registry instance.
	registry.register(createToolListTool(registry));
	return registry;
}

export interface ToolRegistryRunDeps {
	hookRegistry: HookRegistry
	database: Database
	runRegistry: RunRegistry
	sseManager?: SseManager
	providerRouter: ProviderRouter
	configManager: ConfigManager
	currentRun: RunContext
	mode?: 'spec' | 'quick'
	mcpManager?: MCPManager
	metadataEmitter?: MetadataEmitter
	/** Optional instruction service for AGENTS.md/CLAUDE.md guard injection on file-touching tools. */
	instructionService?: InstructionService
	/** Absolute project root path (required when instructionService is provided). */
	projectRoot?: string
}

export function createToolRegistryForRun(deps: ToolRegistryRunDeps): ToolRegistry {
	const registry = new ToolRegistry(deps.hookRegistry)
	// Set the calling agent so the registry can enforce per-tool
	// allowedAgents at the execute() boundary.
	registry.setCurrentAgentName(deps.currentRun.agentType);

	// ── Instruction-aware tool registration ──────────────────────────
	// When instructionService + projectRoot are available (live sessions),
	// register factory-wrapped read/write/edit/apply_patch tools that inject
	// AGENTS.md/CLAUDE.md content from ancestor directories as
	// <system-reminder> blocks in tool output.  When absent (static
	// registry, tests), fall back to the plain tools with no guard.
	const alreadyLoaded = new Set<string>();
	const useInstructionTools = deps.instructionService && deps.projectRoot;

	if (useInstructionTools) {
		const instrDeps = {
			service: deps.instructionService!,
			alreadyLoaded,
			projectRoot: deps.projectRoot!,
		};
		registry.register(createReadTool(instrDeps));
		registry.register(createWriteTool(instrDeps));
		registry.register(createEditTool(instrDeps));
		registry.register(createApplyPatchTool(instrDeps));
	} else {
		registry.register(readTool);
		registry.register(writeTool);
		registry.register(editTool);
		registry.register(applyPatchTool);
	}

	// Register all other static tools (same list as createToolRegistry)
	registry.register(globTool)
	registry.register(grepTool)
	registry.register(bashTool)
	registry.register(webfetchTool)
	registry.register(websearchTool)
	registry.register(getDatetimeTool)
	registry.register(todowriteTool)
	registry.register(todoreadTool)
	// Interactive tools (always registered regardless of session mode)
	for (const tool of createInteractiveTools({})) {
		registry.register(tool)
	}
	registry.register(skillTool)
	registry.register(createToolSearchTool({
		registry,
		runContext: deps.currentRun,
		skillCatalog: extractSkillCatalogFromRegistry(registry),
	}))
	registry.register(referenceTool)
	registry.register(lspTool)
	registry.register(lspDiagnosticsTool)
	const visualizeTool = createVisualizeTool({
		getConfig: async () => {
			const config = await deps.configManager.getConfig()
			return config.ok ? config.data : null
		},
	})
	registry.register(visualizeTool)

	// ── Field Notes tools (per-run deps) ─────────────────────────────────
	// All agents get read-only field notes access; researcher/writer/librarian
	// also get field_notes_write (enforced via allowedAgents on the tool def
	// and double-checked at the registry execute() boundary).
	registry.register(fieldNotesGrepTool);
	registry.register(fieldNotesWriteTool);
	{
		const projectPath = resolveProjectPath(deps.database, deps.currentRun.projectId);
		registry.register(createFieldNotesReadTool({ projectPath }));
		registry.register(createFieldNotesSearchTool({
			embeddingProvider: createDisabledProvider(),
			projectPath,
			database: deps.database,
			currentRun: deps.currentRun,
		}));
		// FieldNotesStore.open is a lazy-init — if the index DB hasn't been
		// created yet the store opens cleanly with zero documents.
		const storeResult = FieldNotesStore.open(projectPath);
		if (storeResult.ok) {
			registry.register(createFieldNotesIndexTool(storeResult.data));
		}
	}

	if (deps.sseManager) {
		// Register task tool (needs per-run deps)
		const taskToolDeps: TaskToolDeps = {
			database: deps.database,
			runRegistry: deps.runRegistry,
			sseManager: deps.sseManager,
			providerRouter: deps.providerRouter,
			hookRegistry: deps.hookRegistry,
			configManager: deps.configManager,
			toolRegistry: registry,
			currentRun: deps.currentRun,
			metadataEmitter: deps.metadataEmitter,
		}
		registry.register(createTaskTool(taskToolDeps))
	}

	// Register agent_session_search tool (needs per-run deps)
	const agentSessionSearchDeps: AgentSessionSearchDeps = {
		database: deps.database,
		currentRun: deps.currentRun,
	}
	registry.register(createAgentSessionSearchTool(agentSessionSearchDeps))

	if ((deps.mode ?? 'quick') === 'spec') {
		const specCtx = createSpecToolContext({
			database: deps.database,
			projectId: deps.currentRun.projectId,
			runId: deps.currentRun.runId,
			hookRegistry: deps.hookRegistry,
		})
		for (const tool of createSpecTools(specCtx)) {
			registry.register(tool)
		}
	}

	if (deps.mcpManager) {
		registry.register(createMcpSearchToolsTool({
			manager: deps.mcpManager,
			getRunContext: () => deps.currentRun,
		}))
	}

	// tool_list MUST be last (reflects full set)
	registry.register(createToolListTool(registry))

	return registry
}
