import type {
	RunContext,
	AgentRunEventEnvelope,
	AgentRunStatusChangedData,
	AgentRunStatus,
	AgentRunToolCallMetadataData,
} from './types.ts'
import { createRunContext } from './context.ts'

interface SsePublisher {
	publish(projectId: string, sessionId: string, eventType: string, data: unknown): void
}

const runEventSequences = new Map<string, number>()

function nextSequence(runId: string): number {
	const current = runEventSequences.get(runId) ?? 0
	const next = current + 1
	runEventSequences.set(runId, next)
	return next
}

// Status Change Coalescer — per-runId 100ms debounce for non-terminal transitions
// Terminal transitions (done, error, cancelled) flush immediately

interface PendingStatusChange {
	timer: ReturnType<typeof setTimeout>
	data: AgentRunStatusChangedData
}

const pendingStatusChanges = new Map<string, PendingStatusChange>()
const COALESCE_MS = 100

function isTerminalStatus(status: AgentRunStatus): boolean {
	return status === 'done' || status === 'error' || status === 'cancelled'
}

/**
 * Publish a status change event with 100ms coalescing per runId.
 * - If prev === next: no-op (suppressed)
 * - If next is terminal: flush immediately, cancel any pending timer
 * - Otherwise: debounce 100ms, emit latest pending on flush
 */
export function publishStatusChange(
	sseManager: SsePublisher,
	data: AgentRunStatusChangedData,
): void {
	// No-op suppression: prev === next
	if (data.previousStatus === data.nextStatus) {
		return
	}

	const existing = pendingStatusChanges.get(data.runId)

	// Terminal transition: flush immediately
	if (isTerminalStatus(data.nextStatus)) {
		// Cancel any pending timer
		if (existing) {
			clearTimeout(existing.timer)
			pendingStatusChanges.delete(data.runId)
		}

		// Emit immediately
		const runContext: RunContext = createRunContext({
			runId: data.runId,
			parentRunId: data.parentRunId,
			depth: 0,
			agentType: data.agentType,
			title: data.title,
			sessionId: data.sessionId,
			projectId: data.projectId,
			signal: new AbortController().signal,
		})

		publishRunEvent(runContext, sseManager, 'agent_run.status_changed', {
			previousStatus: data.previousStatus,
			nextStatus: data.nextStatus,
			reason: data.reason,
		})
		return
	}

	// Non-terminal: reset debounce timer
	if (existing) {
		clearTimeout(existing.timer)
	}

	const timer = setTimeout(() => {
		const pending = pendingStatusChanges.get(data.runId)
		if (!pending) return

		pendingStatusChanges.delete(data.runId)

		const runContext: RunContext = createRunContext({
			runId: pending.data.runId,
			parentRunId: pending.data.parentRunId,
			depth: 0,
			agentType: pending.data.agentType,
			title: pending.data.title,
			sessionId: pending.data.sessionId,
			projectId: pending.data.projectId,
			signal: new AbortController().signal,
		})

		publishRunEvent(runContext, sseManager, 'agent_run.status_changed', {
			previousStatus: pending.data.previousStatus,
			nextStatus: pending.data.nextStatus,
			reason: pending.data.reason,
		})
	}, COALESCE_MS)

	pendingStatusChanges.set(data.runId, { timer, data })
}

/**
 * Clear any pending status change timer for a runId.
 * Call this when a run is being cleaned up (forgetRun).
 */
export function clearStatusCoalescer(runId: string): void {
	const existing = pendingStatusChanges.get(runId)
	if (existing) {
		clearTimeout(existing.timer)
		pendingStatusChanges.delete(runId)
	}
}

/**
 * Get the count of pending status changes (for testing).
 */
export function getPendingStatusChangeCount(): number {
	return pendingStatusChanges.size
}

export function publishRunEvent(
	runCtx: RunContext,
	sseManager: SsePublisher,
	type: string,
	data: unknown,
): AgentRunEventEnvelope {
	const envelope: AgentRunEventEnvelope = {
		ts: new Date().toISOString(),
		projectId: runCtx.projectId,
		sessionId: runCtx.sessionId,
		runId: runCtx.runId,
		parentRunId: runCtx.parentRunId ?? null,
		agentType: runCtx.agentType,
		title: runCtx.title,
		seq: nextSequence(runCtx.runId),
		type,
		data,
	}

	sseManager.publish(runCtx.projectId, runCtx.sessionId, type, envelope)
	return envelope
}

export function clearRunEventSequence(runId: string): void {
	runEventSequences.delete(runId)
}

export function publishToolCallMetadata(
	sseManager: SsePublisher,
	projectId: string,
	data: AgentRunToolCallMetadataData,
): void {
	const sessionId = (
		data as AgentRunToolCallMetadataData & {
			__sessionId?: string
		}
	).__sessionId

	if (!sessionId) {
		return
	}

	// Route metadata to the PARENT transcript stream when available.
	// The tool_call entry we need to enrich lives on the parent run.
	const transcriptRunId = data.parentRunId && data.parentRunId.length > 0
		? data.parentRunId
		: data.runId

	publishRunEvent(
		createRunContext({
			runId: transcriptRunId,
			parentRunId: data.parentRunId,
			depth: 0,
			agentType: data.agentType,
			title: data.title,
			sessionId,
			projectId,
			signal: new AbortController().signal,
		}),
		sseManager,
		'agent_run.tool_call_metadata',
		{
			toolCallId: data.toolCallId,
			runId: data.runId,
			parentRunId: data.parentRunId,
			agentType: data.agentType,
			title: data.title,
		},
	)
}
