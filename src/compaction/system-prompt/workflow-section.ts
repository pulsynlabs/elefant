/** Input shape for the workflow section builder. */
export interface WorkflowSectionInput {
	sessionMode: 'spec' | 'quick';
	workflowState?: {
		phase: string;
		currentWave?: number;
		totalWaves?: number;
	};
}

/** Phase-specific guidance: short imperative, key command, and relevant tools. */
interface PhaseGuide {
	action: string;
	command: string;
	tools: string[];
}

const PHASE_GUIDES: Record<string, PhaseGuide> = {
	discuss: {
		action: 'Gather requirements, constraints, and risks from the user',
		command: '/discuss',
		tools: ['wf_requirements'],
	},
	plan: {
		action: 'Create the specification and execution blueprint from gathered requirements',
		command: '/plan',
		tools: ['wf_spec', 'wf_blueprint'],
	},
	research: {
		action: 'Research unknowns, compare alternatives, and document tradeoffs',
		command: '/fieldnotes',
		tools: ['skill'],
	},
	specify: {
		action: 'Lock the specification contract so execution can begin',
		command: '/plan',
		tools: ['wf_spec'],
	},
	execute: {
		action: 'Execute approved tasks wave by wave, logging decisions and progress',
		command: '/execute',
		tools: ['wf_chronicle', 'wf_adl', 'wf_checkpoint'],
	},
	audit: {
		action: 'Verify implementation against the specification and report gaps',
		command: '/audit',
		tools: ['wf_spec'],
	},
	accept: {
		action: 'Confirm work is complete and ready for user approval',
		command: '/accept',
		tools: [],
	},
	idle: {
		action: 'No active workflow. Use /discuss to start gathering requirements.',
		command: '/discuss',
		tools: [],
	},
};

/**
 * Build the conditional workflow section for the system prompt.
 *
 * - Quick Mode: empty string (no workflow tooling).
 * - Spec Mode, no active workflow: general guidance pointing to /discuss.
 * - Spec Mode, active workflow: phase-specific heading, permitted actions,
 *   key commands, and relevant tools.
 */
export function buildWorkflowSection(ctx: WorkflowSectionInput): string {
	if (ctx.sessionMode !== 'spec') return '';

	const ws = ctx.workflowState;

	// Spec Mode but no active workflow — general onboarding
	if (!ws) {
		return [
			'## Workflow Mode: Spec',
			'- Spec Mode is active but no workflow has been started yet.',
			'- Use `/discuss` to start a discovery interview and create a workflow.',
			'- Workflow flow: discuss → plan → execute → audit → accept',
		].join('\n');
	}

	const phase = ws.phase;
	const waveSuffix =
		ws.currentWave !== undefined && ws.totalWaves !== undefined
			? ` | Wave ${ws.currentWave}/${ws.totalWaves}`
			: '';

	const heading = [
		'## Workflow Mode: Spec',
		`(Phase: ${phase}${waveSuffix})`,
	].join(' ');

	const guide = PHASE_GUIDES[phase];

	if (!guide) {
		return [
			heading,
			'',
			`- You are in the \`${phase}\` phase of the spec-driven workflow.`,
			'- Use workflow tools and slash commands to navigate the phase.',
			'- Prefer `/status` to check current state before acting.',
		].join('\n');
	}

	const lines: string[] = [heading, ''];

	// Phase description
	lines.push(`- Phase: ${phase} — ${guide.action}`);
	lines.push(`- Key command: ${guide.command}`);

	if (guide.tools.length > 0) {
		const toolList = guide.tools.map((t) => `\`${t}\``).join(', ');
		lines.push(`- Relevant tools: ${toolList}`);
	}

	return lines.join('\n');
}
