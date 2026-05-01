import type { StateManager } from '../state/manager.ts';
import type { SpecWorkflowPhase } from '../state/schema.ts';
import type { SpecTool } from '../tools/spec/base.ts';
import type { HookHandler } from './types.ts';

export type PhaseAllowList = Map<string, readonly SpecWorkflowPhase[]>;

type SpecToolArgs = {
	workflowId?: unknown;
	projectId?: unknown;
};

export function createPhaseAllowListFromSpecTools(
	tools: readonly SpecTool[],
): PhaseAllowList {
	return new Map(tools.map((tool) => [tool.name, tool.allowedPhases]));
}

export function createSpecPhaseGateHandler(
	stateManager: StateManager,
	phaseAllowList: PhaseAllowList,
): HookHandler<'tool:before'> {
	return async (ctx) => {
		try {
			const { toolName, args } = ctx;
			if (!toolName.startsWith('wf_')) return;

			const action = typeof args.action === 'string' ? args.action : undefined;
			const allowed = toolName === 'wf_chronicle' && action === 'append'
				? ['execute', 'audit', 'accept'] as const
				: phaseAllowList.get(toolName);
			if (!allowed || allowed.length === 0) return;

			// Spec tools receive projectId/workflowId in their validated payloads; this
			// pre-validation hook can only inspect the raw tool argument record.
			const rawArgs = args as SpecToolArgs;
			const workflowId = rawArgs.workflowId;
			const projectId = rawArgs.projectId;
			if (typeof workflowId !== 'string' || typeof projectId !== 'string') return;

			const workflow = await stateManager.getSpecWorkflow(projectId, workflowId);
			if (!workflow) return;

			if (!allowed.includes(workflow.phase)) {
				return {
					veto: true,
					error: {
						code: 'INVALID_PHASE',
						expected: allowed,
						actual: workflow.phase,
						tool: toolName,
						message: `Tool '${toolName}' is not allowed in phase '${workflow.phase}'. Allowed: ${allowed.join(', ')}`,
					},
				};
			}
		} catch (error) {
			console.error('[elefant] Spec phase gate failed:', error);
		}

		return undefined;
	};
}
