import type { QuestionEmitter } from '../tools/question/emitter.ts'
import { clearStatusCoalescer } from './events.ts'

export interface RunEntry {
	controller: AbortController
	startedAt: Date
	questionEmitter: QuestionEmitter
	parentRunId?: string
	agentType: string
	title: string
}

export class RunRegistry {
	private readonly runs = new Map<string, RunEntry>()
	private readonly childrenMap = new Map<string, Set<string>>()

	registerRun(runId: string, entry: RunEntry): void {
		this.runs.set(runId, entry)
	}

	getRun(runId: string): RunEntry | undefined {
		return this.runs.get(runId)
	}

	registerChildren(parentRunId: string, childRunId: string): void {
		const childRunIds = this.childrenMap.get(parentRunId) ?? new Set<string>()
		childRunIds.add(childRunId)
		this.childrenMap.set(parentRunId, childRunIds)
	}

	getChildRunIds(parentRunId: string): string[] {
		const childRunIds = this.childrenMap.get(parentRunId)
		if (!childRunIds) {
			return []
		}

		return [...childRunIds]
	}

	abortRun(runId: string): boolean {
		return this.abortRunRecursive(runId, new Set<string>())
	}

	private abortRunRecursive(runId: string, visited: Set<string>): boolean {
		if (visited.has(runId)) {
			return false
		}

		visited.add(runId)

		for (const childRunId of this.getChildRunIds(runId)) {
			this.abortRunRecursive(childRunId, visited)
		}

		const entry = this.runs.get(runId)
		if (!entry) {
			return false
		}

		entry.controller.abort()
		this.forgetRun(runId)
		return true
	}

	forgetRun(runId: string): void {
		const entry = this.runs.get(runId)
		this.runs.delete(runId)

		// Clear any pending status change timer for this run
		clearStatusCoalescer(runId)

		if (entry?.parentRunId) {
			const siblingRunIds = this.childrenMap.get(entry.parentRunId)
			if (siblingRunIds) {
				siblingRunIds.delete(runId)
				if (siblingRunIds.size === 0) {
					this.childrenMap.delete(entry.parentRunId)
				}
			}
		}

		this.childrenMap.delete(runId)
	}
}
