export interface OrchestratorGateRequest {
	agentType?: string;
	tool: string;
	targetPath?: string;
}

const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch']);

// Source file paths that orchestrators ARE allowed to touch.
const ALLOWED_PREFIXES = ['.elefant/', '.goopspec/', 'src/tools/spec/', 'src/agents/'];

function normalizePath(path: string): string {
	const withoutLeadingCurrentDir = path.startsWith('./') ? path.slice(2) : path;
	const cwd = `${process.cwd()}/`;
	return withoutLeadingCurrentDir.startsWith(cwd)
		? withoutLeadingCurrentDir.slice(cwd.length)
		: withoutLeadingCurrentDir;
}

export function evaluateOrchestratorGate(
	req: OrchestratorGateRequest,
): 'deny' | 'allow' {
	if (req.agentType !== 'goop-orchestrator') return 'allow';
	if (!WRITE_TOOLS.has(req.tool)) return 'allow';

	const path = normalizePath(req.targetPath ?? '');
	if (ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'allow';

	return 'deny';
}

export const ORCHESTRATOR_NO_WRITE_MESSAGE =
	"Orchestrators cannot modify source files directly. Dispatch via `task({ subagent_type: 'goop-executor-{tier}' })`.";
