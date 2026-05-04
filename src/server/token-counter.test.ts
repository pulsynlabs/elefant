import { describe, expect, it } from 'bun:test'
import { TokenCounter } from './token-counter.ts'

describe('TokenCounter', () => {
	it('increments window and session on text deltas', () => {
		const counter = new TokenCounter()
		const first = counter.recordTextDelta('session-1', 'Hello world')
		expect(first.windowTokens).toBeGreaterThan(0)
		expect(first.sessionTokens).toBe(first.windowTokens)

		const second = counter.recordTextDelta('session-1', ' Another sentence')
		expect(second.windowTokens).toBeGreaterThan(first.windowTokens)
		expect(second.sessionTokens).toBeGreaterThan(first.sessionTokens)
	})

	it('does not reduce session total after compaction', () => {
		const counter = new TokenCounter()
		counter.recordTextDelta('session-2', 'Lots of text to consume tokens')
		const before = counter.getSnapshot('session-2')

		const compacted = counter.recordCompaction('session-2', 8)
		expect(compacted.windowTokens).toBe(8)
		expect(compacted.sessionTokens).toBe(before.sessionTokens)
	})

	it('accepts usage snapshots and keeps session monotonic', () => {
		const counter = new TokenCounter()
		counter.recordTextDelta('session-3', 'seed')
		const afterSeed = counter.getSnapshot('session-3')

		const usage = counter.recordUsageSnapshot('session-3', 50, 15)
		expect(usage.windowTokens).toBe(65)
		expect(usage.sessionTokens).toBeGreaterThanOrEqual(afterSeed.sessionTokens)
	})

	it('emits ordered token events to listeners', () => {
		const counter = new TokenCounter()
		const received: string[] = []
		const unsubscribe = counter.subscribe('session-4', (event) => {
			received.push(event.type)
		})

		counter.recordTextDelta('session-4', 'hello')
		unsubscribe()

		expect(received[0]).toBe('tokens.window')
		expect(received[1]).toBe('tokens.session')
		expect(received[2]).toBe('tokens.breakdown')
	})
})
