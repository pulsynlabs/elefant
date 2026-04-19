import { describe, expect, it } from 'bun:test'

import { clearRunEventSequence, publishRunEvent } from './events.ts'
import type { RunContext } from './types.ts'

describe('publishRunEvent', () => {
	it('publishes all agent-run event types through SseManager', () => {
		const runContext: RunContext = {
			runId: crypto.randomUUID(),
			parentRunId: crypto.randomUUID(),
			depth: 0,
			agentType: 'executor',
			title: 'Event test',
			sessionId: crypto.randomUUID(),
			projectId: crypto.randomUUID(),
			signal: new AbortController().signal,
		}

		const captured: Array<{
			projectId: string
			sessionId: string
			eventType: string
			data: unknown
		}> = []

		const sseManager = {
			publish: (projectId: string, sessionId: string, eventType: string, data: unknown) => {
				captured.push({ projectId, sessionId, eventType, data })
			},
		}

		const eventTypes = [
			'agent_run.spawned',
			'agent_run.token',
			'agent_run.tool_call',
			'agent_run.tool_result',
			'agent_run.question',
			'agent_run.done',
			'agent_run.error',
			'agent_run.cancelled',
		]

		for (const eventType of eventTypes) {
			publishRunEvent(runContext, sseManager, eventType, { eventType })
		}

		expect(captured.length).toBe(eventTypes.length)
		for (let index = 0; index < eventTypes.length; index += 1) {
			const event = captured[index]
			expect(event?.projectId).toBe(runContext.projectId)
			expect(event?.sessionId).toBe(runContext.sessionId)
			expect(event?.eventType).toBe(eventTypes[index])

			const envelope = event?.data as {
				runId: string
				parentRunId: string | null
				agentType: string
				title: string
				seq: number
				type: string
				data: { eventType: string }
			}

			expect(envelope.runId).toBe(runContext.runId)
			expect(envelope.parentRunId).toBe(runContext.parentRunId)
			expect(envelope.agentType).toBe(runContext.agentType)
			expect(envelope.title).toBe(runContext.title)
			expect(envelope.type).toBe(eventTypes[index])
			expect(envelope.seq).toBe(index + 1)
		}

		clearRunEventSequence(runContext.runId)
	})
})
