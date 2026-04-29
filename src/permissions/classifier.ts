import type { ClassifierRule, Risk } from './types.ts';
import {
	evaluateOrchestratorGate,
	ORCHESTRATOR_NO_WRITE_MESSAGE,
} from './orchestrator-gate.ts';

export interface ClassificationContext {
	agentType?: string;
}

export type PermissionClassification =
	| { decision: 'risk'; risk: Risk }
	| { decision: 'deny'; reason: 'ORCHESTRATOR_NO_WRITE'; message: string };

function extractTargetPath(args: Record<string, unknown>): string | undefined {
	const candidates = [args.targetPath, args.filePath, args.path];
	for (const candidate of candidates) {
		if (typeof candidate === 'string') return candidate;
	}

	return undefined;
}

export const DEFAULT_CLASSIFIER_RULES: ClassifierRule[] = [
	{
		tool: 'bash',
		argsPattern: (args) =>
			typeof args.command === 'string' && /rm\s+-rf/.test(args.command),
		risk: 'high',
	},
	{
		tool: 'bash',
		argsPattern: (args) =>
			typeof args.command === 'string' && /git\s+push/.test(args.command),
		risk: 'high',
	},
	{
		tool: 'bash',
		argsPattern: (args) =>
			typeof args.command === 'string' && /sudo/.test(args.command),
		risk: 'high',
	},
	{
		tool: 'write',
		argsPattern: (args) =>
			typeof args.path === 'string' && /\.(env|pem|key|secret)$/.test(args.path),
		risk: 'high',
	},
	{
		tool: 'edit',
		argsPattern: (args) =>
			typeof args.path === 'string' && /\.(env|pem|key|secret)$/.test(args.path),
		risk: 'high',
	},
	{ tool: 'webfetch', risk: 'high' },
	{ tool: 'websearch', risk: 'high' },
	{ tool: 'write', risk: 'medium' },
	{ tool: 'edit', risk: 'medium' },
	{ tool: 'apply_patch', risk: 'medium' },
	{ tool: 'read', risk: 'low' },
	{ tool: 'glob', risk: 'low' },
	{ tool: 'grep', risk: 'low' },
	{ tool: 'todoread', risk: 'low' },
	{ tool: 'skill', risk: 'low' },
	{ tool: 'lsp', risk: 'low' },
	{ tool: 'task', risk: 'low' },
	{ tool: 'todowrite', risk: 'low' },
	{ tool: 'question', risk: 'low' },
	{ tool: 'tool_list', risk: 'low' },
	{ tool: 'agent_session_search', risk: 'low' },
];

export function classify(
	tool: string,
	args: Record<string, unknown>,
	rules: ClassifierRule[] = DEFAULT_CLASSIFIER_RULES,
): Risk {
	const structured = classifyPermission(tool, args, rules);
	if (structured.decision === 'deny') return 'high';
	return structured.risk;
}

export function classifyPermission(
	tool: string,
	args: Record<string, unknown>,
	rules: ClassifierRule[] = DEFAULT_CLASSIFIER_RULES,
	context: ClassificationContext = {},
): PermissionClassification {
	if (
		evaluateOrchestratorGate({
			agentType: context.agentType,
			tool,
			targetPath: extractTargetPath(args),
		}) === 'deny'
	) {
		return {
			decision: 'deny',
			reason: 'ORCHESTRATOR_NO_WRITE',
			message: ORCHESTRATOR_NO_WRITE_MESSAGE,
		};
	}

	for (const rule of rules) {
		const toolMatches =
			typeof rule.tool === 'string' ? rule.tool === tool : rule.tool.test(tool);

		if (!toolMatches) {
			continue;
		}

		if (rule.argsPattern && !rule.argsPattern(args)) {
			continue;
		}

		return { decision: 'risk', risk: rule.risk };
	}

	return { decision: 'risk', risk: 'high' };
}
