import { describe, expect, it } from 'bun:test'

import { RunRegistry } from './registry.ts'

function registerRun(registry: RunRegistry, runId: string, parentRunId?: string): AbortController {
	const controller = new AbortController()
	registry.registerRun(runId, {
		controller,
		startedAt: new Date(),
		questionEmitter: () => undefined,
		parentRunId,
		agentType: 'executor',
		title: 'Test run',
	})
	return controller
}

describe('RunRegistry', () => {
	it('handles register, abort, and forget lifecycle', () => {
		const registry = new RunRegistry()
		const runId = crypto.randomUUID()

		const controller = new AbortController()
		let observedAbort = false
		controller.signal.addEventListener('abort', () => {
			observedAbort = true
		})

		registry.registerRun(runId, {
			controller,
			startedAt: new Date(),
			questionEmitter: () => undefined,
			agentType: 'executor',
			title: 'Registry lifecycle',
		})

		expect(registry.getRun(runId)).toBeDefined()

		const abortResult = registry.abortRun(runId)
		expect(abortResult).toBe(true)
		expect(observedAbort).toBe(true)
		expect(registry.getRun(runId)).toBeUndefined()

		const missingAbort = registry.abortRun('does-not-exist')
		expect(missingAbort).toBe(false)

		registry.registerRun(runId, {
			controller: new AbortController(),
			startedAt: new Date(),
			questionEmitter: () => undefined,
			agentType: 'executor',
			title: 'Forget me',
		})
		expect(registry.getRun(runId)).toBeDefined()

		registry.forgetRun(runId)
		expect(registry.getRun(runId)).toBeUndefined()
	})

	it('registers child run IDs under a parent run', () => {
		const registry = new RunRegistry()
		const parentRunId = crypto.randomUUID()
		const childRunIdA = crypto.randomUUID()
		const childRunIdB = crypto.randomUUID()

		registerRun(registry, parentRunId)
		registerRun(registry, childRunIdA, parentRunId)
		registerRun(registry, childRunIdB, parentRunId)

		registry.registerChildren(parentRunId, childRunIdA)
		registry.registerChildren(parentRunId, childRunIdB)

		expect(new Set(registry.getChildRunIds(parentRunId))).toEqual(
			new Set([childRunIdA, childRunIdB]),
		)
	})

	it('cascades abort from parent to registered children', () => {
		const registry = new RunRegistry()
		const parentRunId = crypto.randomUUID()
		const childRunIdA = crypto.randomUUID()
		const childRunIdB = crypto.randomUUID()

		const parentController = registerRun(registry, parentRunId)
		const childControllerA = registerRun(registry, childRunIdA, parentRunId)
		const childControllerB = registerRun(registry, childRunIdB, parentRunId)

		registry.registerChildren(parentRunId, childRunIdA)
		registry.registerChildren(parentRunId, childRunIdB)

		expect(registry.abortRun(parentRunId)).toBe(true)
		expect(parentController.signal.aborted).toBe(true)
		expect(childControllerA.signal.aborted).toBe(true)
		expect(childControllerB.signal.aborted).toBe(true)
	})

	it('handles stale child run IDs during cascading abort', () => {
		const registry = new RunRegistry()
		const parentRunId = crypto.randomUUID()
		const childRunId = crypto.randomUUID()

		const parentController = registerRun(registry, parentRunId)
		registerRun(registry, childRunId, parentRunId)

		registry.registerChildren(parentRunId, childRunId)
		registry.forgetRun(childRunId)

		expect(() => registry.abortRun(parentRunId)).not.toThrow()
		expect(parentController.signal.aborted).toBe(true)
	})

	it("removes child from parent's child set when child is forgotten", () => {
		const registry = new RunRegistry()
		const parentRunId = crypto.randomUUID()
		const childRunId = crypto.randomUUID()

		registerRun(registry, parentRunId)
		registerRun(registry, childRunId, parentRunId)

		registry.registerChildren(parentRunId, childRunId)
		expect(registry.getChildRunIds(parentRunId)).toEqual([childRunId])

		registry.forgetRun(childRunId)
		expect(registry.getChildRunIds(parentRunId)).toEqual([])
	})
})
