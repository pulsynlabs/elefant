import { ok, type Result } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import type { ToolDefinition } from '../../types/tools.ts';
import { StateManager } from '../../state/manager.ts';
import type { HookRegistry } from '../../hooks/registry.ts';
import { SpecTool, type SpecToolContext } from './base.ts';
import { SpecStatusTool, SpecStateTool, SpecWorkflowTool } from './state-tools.ts';
import { SpecBlueprintTool, SpecRequirementsTool, SpecSpecTool } from './document-tools.ts';
import { SpecAdlTool, SpecCheckpointTool, SpecChronicleTool, SpecReferenceTool, SpecSkillTool } from './log-tools.ts';

export {
	SpecTool,
	SpecStatusTool,
	SpecStateTool,
	SpecWorkflowTool,
	SpecRequirementsTool,
	SpecSpecTool,
	SpecBlueprintTool,
	SpecChronicleTool,
	SpecAdlTool,
	SpecCheckpointTool,
	SpecSkillTool,
	SpecReferenceTool,
};
export type { SpecToolContext } from './base.ts';

export function instantiateSpecTools(): SpecTool[] {
	return [
		new SpecStatusTool(),
		new SpecStateTool(),
		new SpecWorkflowTool(),
		new SpecRequirementsTool(),
		new SpecSpecTool(),
		new SpecBlueprintTool(),
		new SpecChronicleTool(),
		new SpecAdlTool(),
		new SpecCheckpointTool(),
		new SpecSkillTool(),
		new SpecReferenceTool(),
	];
}

export function createSpecTools(ctx: SpecToolContext): ToolDefinition<unknown, unknown>[] {
	return instantiateSpecTools().map((tool) => toToolDefinition(tool, ctx));
}

export function toToolDefinition(tool: SpecTool, ctx: SpecToolContext): ToolDefinition<unknown, unknown> {
	return {
		name: tool.name,
		description: tool.description,
		parameters: {},
		execute: async (args: unknown): Promise<Result<unknown, ElefantError>> => ok(await tool.run(ctx, args)),
	};
}

export function createSpecToolContext(input: {
	database: SpecToolContext['database'];
	projectId: string;
	runId?: string;
	hookRegistry?: HookRegistry;
}): SpecToolContext {
	const project = input.database.db
		.query('SELECT id, name, path FROM projects WHERE id = ?')
		.get(input.projectId) as { id: string; name: string; path: string } | null;
	const active = input.database.db
		.query('SELECT workflow_id FROM spec_workflows WHERE project_id = ? AND is_active = 1 LIMIT 1')
		.get(input.projectId) as { workflow_id: string } | null;
	const projectMeta = project ?? { id: input.projectId, name: input.projectId, path: process.cwd() };

	return {
		database: input.database,
		projectId: input.projectId,
		workflowId: active?.workflow_id ?? 'spec-mode',
		runId: input.runId,
		stateManager: new StateManager(projectMeta.path, {
			id: projectMeta.id,
			name: projectMeta.name,
			path: projectMeta.path,
			database: input.database,
			hookRegistry: input.hookRegistry,
		}),
		hookRegistry: input.hookRegistry,
	};
}
