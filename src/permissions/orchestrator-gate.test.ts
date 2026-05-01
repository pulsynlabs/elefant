import { describe, expect, it } from 'bun:test';

import { classifyPermission } from './classifier.ts';
import { evaluateOrchestratorGate } from './orchestrator-gate.ts';

describe('orchestrator gate', () => {
	it('denies orchestrator write to a source file', () => {
		expect(evaluateOrchestratorGate({ agentType: 'goop-orchestrator', tool: 'write', targetPath: 'src/foo.ts' })).toBe('deny');
	});

	it('allows orchestrator writes under .elefant', () => {
		expect(evaluateOrchestratorGate({ agentType: 'goop-orchestrator', tool: 'write', targetPath: '.elefant/state.json' })).toBe('allow');
	});

	it('allows orchestrator writes under .goopspec', () => {
		expect(evaluateOrchestratorGate({ agentType: 'goop-orchestrator', tool: 'write', targetPath: '.goopspec/spec-mode/SPEC.md' })).toBe('allow');
	});

	it('allows orchestrator read calls', () => {
		expect(evaluateOrchestratorGate({ agentType: 'goop-orchestrator', tool: 'read', targetPath: 'src/foo.ts' })).toBe('allow');
	});

	it('allows non-orchestrator writes so the classifier can handle risk tier', () => {
		expect(evaluateOrchestratorGate({ agentType: 'goop-executor-high', tool: 'write', targetPath: 'src/foo.ts' })).toBe('allow');
	});

	it('allows writes without an agent type', () => {
		expect(evaluateOrchestratorGate({ tool: 'write', targetPath: 'src/foo.ts' })).toBe('allow');
	});

	it('denies orchestrator apply_patch to a Svelte source file', () => {
		expect(evaluateOrchestratorGate({ agentType: 'goop-orchestrator', tool: 'apply_patch', targetPath: 'src/components/Button.svelte' })).toBe('deny');
	});

	it('allows orchestrator writes to spec tool internals', () => {
		expect(evaluateOrchestratorGate({ agentType: 'goop-orchestrator', tool: 'write', targetPath: 'src/tools/workflow/state-tools.ts' })).toBe('allow');
	});

	it('returns a structured deny classification with exact reason code', () => {
		const result = classifyPermission('write', { filePath: 'src/foo.ts' }, undefined, { agentType: 'goop-orchestrator' });
		expect(result).toEqual({
			decision: 'deny',
			reason: 'ORCHESTRATOR_NO_WRITE',
			message: "Orchestrators cannot modify source files directly. Dispatch via `task({ subagent_type: 'goop-executor-{tier}' })`.",
		});
	});
});
