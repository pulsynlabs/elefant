import { encode } from 'gpt-tokenizer'

type TokenBreakdownCategory =
	| 'system'
	| 'tools'
	| 'messages'
	| 'active_tool_calls'
	| 'mcp_schemas'
	| 'file_contents'
	| 'images'
	| 'assistant_output'
	| 'other'

export interface TokenBreakdownSegment {
	name: string
	category: TokenBreakdownCategory
	tokens: number
}

export interface TokenSnapshot {
	sessionId: string
	windowTokens: number
	windowMax: number
	sessionTokens: number
	breakdown: TokenBreakdownSegment[]
	updatedAt: number
}

export interface TokenDeltaEvent {
	type: 'tokens.window' | 'tokens.session' | 'tokens.breakdown'
	sessionId: string
	data: {
		windowTokens: number
		windowMax: number
		sessionTokens: number
		breakdown?: TokenBreakdownSegment[]
		deltaTokens?: number
		reason?: string
	}
	ts: string
}

type Listener = (event: TokenDeltaEvent) => void

const DEFAULT_WINDOW_MAX = 200_000

function countTokens(text: string): number {
	if (!text) return 0
	try {
		return encode(text).length
	} catch {
		// conservative fallback when tokenizer fails unexpectedly
		return Math.ceil(text.length / 4)
	}
}

function cloneBreakdown(breakdown: TokenBreakdownSegment[]): TokenBreakdownSegment[] {
	return breakdown.map((segment) => ({ ...segment }))
}

export class TokenCounter {
	private readonly bySession = new Map<string, TokenSnapshot>()
	private readonly listenersBySession = new Map<string, Set<Listener>>()

	recordTextDelta(sessionId: string, text: string, windowMax = DEFAULT_WINDOW_MAX): TokenSnapshot {
		const delta = countTokens(text)
		return this.applyDelta(sessionId, delta, 'assistant_output', 'stream_delta', windowMax)
	}

	recordUsageSnapshot(
		sessionId: string,
		inputTokens: number,
		outputTokens: number,
		windowMax = DEFAULT_WINDOW_MAX,
	): TokenSnapshot {
		const next = this.ensure(sessionId, windowMax)
		const combined = Math.max(0, inputTokens + outputTokens)
		const clamped = Math.max(0, Math.floor(combined))
		const delta = Math.max(0, clamped - next.windowTokens)
		next.windowTokens = clamped
		next.sessionTokens += delta
		next.updatedAt = Date.now()
		this.upsertBreakdown(next, 'assistant_output', 'assistant_output', next.windowTokens)
		this.emitAll(next, delta, 'usage_snapshot')
		return this.clone(next)
	}

	recordCompaction(sessionId: string, nextWindowBaseline = 0, windowMax = DEFAULT_WINDOW_MAX): TokenSnapshot {
		const snapshot = this.ensure(sessionId, windowMax)
		snapshot.windowTokens = Math.max(0, Math.floor(nextWindowBaseline))
		snapshot.updatedAt = Date.now()
		snapshot.breakdown = snapshot.breakdown
			.filter((segment) => segment.category !== 'assistant_output')
			.map((segment) => ({ ...segment }))
		this.emitAll(snapshot, 0, 'compaction')
		return this.clone(snapshot)
	}

	setBreakdown(sessionId: string, segments: TokenBreakdownSegment[], windowMax = DEFAULT_WINDOW_MAX): TokenSnapshot {
		const snapshot = this.ensure(sessionId, windowMax)
		snapshot.breakdown = cloneBreakdown(segments)
		snapshot.updatedAt = Date.now()
		this.emitBreakdown(snapshot)
		return this.clone(snapshot)
	}

	getSnapshot(sessionId: string, windowMax = DEFAULT_WINDOW_MAX): TokenSnapshot {
		return this.clone(this.ensure(sessionId, windowMax))
	}

	clearSession(sessionId: string): void {
		this.bySession.delete(sessionId)
		this.listenersBySession.delete(sessionId)
	}

	resetForTests(): void {
		this.bySession.clear()
		this.listenersBySession.clear()
	}

	subscribe(sessionId: string, listener: Listener): () => void {
		let listeners = this.listenersBySession.get(sessionId)
		if (!listeners) {
			listeners = new Set()
			this.listenersBySession.set(sessionId, listeners)
		}
		listeners.add(listener)

		return () => {
			const set = this.listenersBySession.get(sessionId)
			if (!set) return
			set.delete(listener)
			if (set.size === 0) this.listenersBySession.delete(sessionId)
		}
	}

	private ensure(sessionId: string, windowMax: number): TokenSnapshot {
		const existing = this.bySession.get(sessionId)
		if (existing) {
			existing.windowMax = windowMax
			return existing
		}

		const created: TokenSnapshot = {
			sessionId,
			windowTokens: 0,
			windowMax,
			sessionTokens: 0,
			breakdown: [],
			updatedAt: Date.now(),
		}
		this.bySession.set(sessionId, created)
		return created
	}

	private applyDelta(
		sessionId: string,
		deltaTokens: number,
		category: TokenBreakdownCategory,
		name: string,
		windowMax: number,
	): TokenSnapshot {
		const snapshot = this.ensure(sessionId, windowMax)
		const delta = Math.max(0, Math.floor(deltaTokens))
		snapshot.windowTokens += delta
		snapshot.sessionTokens += delta
		snapshot.updatedAt = Date.now()
		this.upsertBreakdown(snapshot, category, name, delta)
		this.emitAll(snapshot, delta, 'delta')
		return this.clone(snapshot)
	}

	private upsertBreakdown(
		snapshot: TokenSnapshot,
		category: TokenBreakdownCategory,
		name: string,
		tokenDelta: number,
	): void {
		if (tokenDelta === 0) return
		const existing = snapshot.breakdown.find((segment) => segment.name === name)
		if (existing) {
			existing.tokens += tokenDelta
			return
		}

		snapshot.breakdown.push({
			name,
			category,
			tokens: tokenDelta,
		})
	}

	private emitAll(snapshot: TokenSnapshot, deltaTokens: number, reason: string): void {
		this.emit(snapshot.sessionId, {
			type: 'tokens.window',
			sessionId: snapshot.sessionId,
			data: {
				windowTokens: snapshot.windowTokens,
				windowMax: snapshot.windowMax,
				sessionTokens: snapshot.sessionTokens,
				deltaTokens,
				reason,
			},
			ts: new Date(snapshot.updatedAt).toISOString(),
		})

		this.emit(snapshot.sessionId, {
			type: 'tokens.session',
			sessionId: snapshot.sessionId,
			data: {
				windowTokens: snapshot.windowTokens,
				windowMax: snapshot.windowMax,
				sessionTokens: snapshot.sessionTokens,
				deltaTokens,
				reason,
			},
			ts: new Date(snapshot.updatedAt).toISOString(),
		})

		this.emitBreakdown(snapshot)
	}

	private emitBreakdown(snapshot: TokenSnapshot): void {
		this.emit(snapshot.sessionId, {
			type: 'tokens.breakdown',
			sessionId: snapshot.sessionId,
			data: {
				windowTokens: snapshot.windowTokens,
				windowMax: snapshot.windowMax,
				sessionTokens: snapshot.sessionTokens,
				breakdown: cloneBreakdown(snapshot.breakdown),
			},
			ts: new Date(snapshot.updatedAt).toISOString(),
		})
	}

	private emit(sessionId: string, event: TokenDeltaEvent): void {
		const listeners = this.listenersBySession.get(sessionId)
		if (!listeners || listeners.size === 0) {
			return
		}

		for (const listener of listeners) {
			listener(event)
		}
	}

	private clone(snapshot: TokenSnapshot): TokenSnapshot {
		return {
			...snapshot,
			breakdown: cloneBreakdown(snapshot.breakdown),
		}
	}
}

export const tokenCounter = new TokenCounter()
