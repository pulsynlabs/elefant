import { describe, expect, it } from 'bun:test'

import type { Message } from '../types/providers.ts'
import { buildInitialMessages, createRunContext } from './context.ts'

describe('buildInitialMessages', () => {
	it('returns an empty message list for none mode', () => {
		const source = buildInitialMessages({
			contextMode: 'none',
			sessionId: 'session-1',
			db: {
				getSessionMessages: () => [{ role: 'user', content: 'ignored' }],
			},
		})

		expect(source.contextMode).toBe('none')
		expect(source.getMessages()).toEqual([])
	})

	it('creates a frozen snapshot copy in snapshot mode', () => {
		const backingStore: Message[] = [{ role: 'user', content: 'first' }]
		const source = buildInitialMessages({
			contextMode: 'snapshot',
			sessionId: 'session-2',
			db: {
				getSessionMessages: () => backingStore,
			},
		})

		backingStore.push({ role: 'assistant', content: 'later' })

		expect(source.contextMode).toBe('snapshot')
		expect(source.getMessages()).toEqual([{ role: 'user', content: 'first' }])
	})

	it('returns live session messages in inherit_session mode', () => {
		const backingStore: Message[] = [{ role: 'user', content: 'start' }]
		const source = buildInitialMessages({
			contextMode: 'inherit_session',
			sessionId: 'session-3',
			db: {
				getSessionMessages: () => backingStore,
			},
		})

		expect(source.getMessages()).toEqual([{ role: 'user', content: 'start' }])

		backingStore.push({ role: 'assistant', content: 'new message' })

		expect(source.getMessages()).toEqual([
			{ role: 'user', content: 'start' },
			{ role: 'assistant', content: 'new message' },
		])
	})
})

describe('createRunContext', () => {
	it('initialises discoveredMcpTools as an empty Set', () => {
		const context = createRunContext({
			runId: 'run-1',
			depth: 0,
			agentType: 'executor',
			title: 'Run',
			sessionId: 'session-1',
			projectId: 'project-1',
			signal: new AbortController().signal,
		})

		expect(context.discoveredMcpTools).toBeInstanceOf(Set)
		expect(context.discoveredMcpTools.size).toBe(0)
	})

	it('keeps discoveredMcpTools mutable on the same context reference', () => {
		const context = createRunContext({
			runId: 'run-1',
			depth: 0,
			agentType: 'executor',
			title: 'Run',
			sessionId: 'session-1',
			projectId: 'project-1',
			signal: new AbortController().signal,
		})

		const sameReference = context
		sameReference.discoveredMcpTools.add('read_file')

		expect(context.discoveredMcpTools.has('read_file')).toBe(true)
	})
})
