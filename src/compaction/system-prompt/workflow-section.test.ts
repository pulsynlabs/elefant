import { describe, expect, it } from 'bun:test'

import { buildWorkflowSection } from './workflow-section.ts'

describe('buildWorkflowSection', () => {
	// -----------------------------------------------------------------------
	// Quick Mode
	// -----------------------------------------------------------------------

	it('returns empty string for Quick Mode sessions', () => {
		const result = buildWorkflowSection({
			sessionMode: 'quick',
			workflowState: { phase: 'execute', currentWave: 3, totalWaves: 6 },
		})

		expect(result).toBe('')
	})

	it('returns empty string for Quick Mode even without workflow state', () => {
		const result = buildWorkflowSection({
			sessionMode: 'quick',
		})

		expect(result).toBe('')
	})

	// -----------------------------------------------------------------------
	// Spec Mode — no active workflow
	// -----------------------------------------------------------------------

	it('returns general guidance for Spec Mode with no active workflow', () => {
		const result = buildWorkflowSection({ sessionMode: 'spec' })

		expect(result).toContain('## Workflow Mode: Spec')
		expect(result).toContain('/discuss')
		expect(result).toContain('discuss → plan → execute → audit → accept')
		// Must NOT contain phase-specific details
		expect(result).not.toContain('Phase:')
	})

	// -----------------------------------------------------------------------
	// Spec Mode — active workflow, phase-specific content
	// -----------------------------------------------------------------------

	it('includes phase and wave in heading for active workflow', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'execute', currentWave: 3, totalWaves: 6 },
		})

		expect(result).toContain('## Workflow Mode: Spec (Phase: execute | Wave 3/6)')
	})

	it('omits wave portion when currentWave or totalWaves is absent', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'execute' },
		})

		expect(result).toContain('## Workflow Mode: Spec (Phase: execute)')
		expect(result).not.toContain('| Wave')
	})

	// ---------- phase: discuss ----------

	it('provides discuss-phase guidance', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'discuss', currentWave: 1, totalWaves: 3 },
		})

		expect(result).toContain('Phase: discuss')
		expect(result).toContain('Gather requirements')
		expect(result).toContain('/discuss')
		expect(result).toContain('wf_requirements')
	})

	// ---------- phase: plan ----------

	it('provides plan-phase guidance', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'plan', currentWave: 1, totalWaves: 3 },
		})

		expect(result).toContain('Phase: plan')
		expect(result).toContain('execution blueprint')
		expect(result).toContain('/plan')
		expect(result).toContain('wf_spec')
		expect(result).toContain('wf_blueprint')
	})

	// ---------- phase: research ----------

	it('provides research-phase guidance', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'research' },
		})

		expect(result).toContain('Phase: research')
		expect(result).toContain('Research unknowns')
		expect(result).toContain('/fieldnotes')
		expect(result).toContain('skill')
	})

	// ---------- phase: specify ----------

	it('provides specify-phase guidance', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'specify' },
		})

		expect(result).toContain('Phase: specify')
		expect(result).toContain('Lock the specification')
		expect(result).toContain('/plan')
		expect(result).toContain('wf_spec')
	})

	// ---------- phase: execute ----------

	it('provides execute-phase guidance', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'execute', currentWave: 2, totalWaves: 5 },
		})

		expect(result).toContain('Phase: execute')
		expect(result).toContain('Execute approved tasks')
		expect(result).toContain('/execute')
		expect(result).toContain('wf_chronicle')
		expect(result).toContain('wf_adl')
		expect(result).toContain('wf_checkpoint')
	})

	// ---------- phase: audit ----------

	it('provides audit-phase guidance', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'audit', currentWave: 6, totalWaves: 6 },
		})

		expect(result).toContain('Phase: audit')
		expect(result).toContain('Verify implementation')
		expect(result).toContain('/audit')
		expect(result).toContain('wf_spec')
	})

	// ---------- phase: accept ----------

	it('provides accept-phase guidance', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'accept', currentWave: 6, totalWaves: 6 },
		})

		expect(result).toContain('Phase: accept')
		expect(result).toContain('Confirm work is complete')
		expect(result).toContain('/accept')
	})

	// ---------- phase: idle ----------

	it('provides idle-phase guidance', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'idle' },
		})

		expect(result).toContain('Phase: idle')
		expect(result).toContain('No active workflow')
		expect(result).toContain('/discuss')
	})

	// ---------- unknown / future phase ----------

	it('gracefully handles an unknown phase with a generic message', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'some-future-phase' },
		})

		expect(result).toContain('Phase: some-future-phase')
		expect(result).toContain('You are in the `some-future-phase` phase')
	})

	// -----------------------------------------------------------------------
	// Distinct from wf-context-block (no raw state dump)
	// -----------------------------------------------------------------------

	it('does not duplicate raw state information from wf-context-block', () => {
		const result = buildWorkflowSection({
			sessionMode: 'spec',
			workflowState: { phase: 'execute', currentWave: 3, totalWaves: 6 },
		})

		// These are bold-label wf-context-block concerns, not guidance concerns
		// (use the bold-label pattern `**Label:**` to avoid matching the heading)
		expect(result).not.toContain('**Spec Locked:**')
		expect(result).not.toContain('**Phase:**')
		expect(result).not.toContain('Must-Haves')
		expect(result).not.toContain('ADL')
		expect(result).not.toContain('**Mode:**')
		expect(result).not.toContain('**Depth:**')
		expect(result).not.toContain('Autopilot')
		expect(result).not.toContain('task summary')
	})
})
