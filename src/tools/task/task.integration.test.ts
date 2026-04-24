import { describe, expect, it, spyOn } from 'bun:test'

import { Database } from '../../db/database.js'
import { HookRegistry } from '../../hooks/registry.ts'
import { createRun } from '../../runs/dal.js'
import { RunRegistry } from '../../runs/registry.ts'
import type { RunContext } from '../../runs/types.js'
import { runAgentLoop } from '../../server/agent-loop.js'
import { createAgentSessionSearchTool } from '../agent_session_search/index.js'
import { createTaskTool } from './index.js'

// Mock agent loop event types
type MockAgentLoopEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'done' }
	| { type: 'tool_call_complete'; toolCall: { id: string; name: string; arguments: Record<string, unknown> } }
	| { type: 'tool_result'; toolResult: { toolCallId: string; content: string } }
	| { type: 'error'; error: { message: string } }

/**
 * Integration smoke test for the synchronous task tool + message persistence + search flow.
 *
 * This test verifies the end-to-end flow:
 * 1. Spawn a child task synchronously
 * 2. Messages are persisted during execution
 * 3. Rich result is returned with finalMessage and toolCallSummary
 * 4. agent_session_search can query the persisted messages
 */
describe('task tool integration', () => {
	function setupTestHarness() {
		// In-memory database with all migrations applied
		const database = new Database(':memory:')

		// Create project and session for realistic context
		const projectId = crypto.randomUUID()
		const sessionId = crypto.randomUUID()

		database.db.run('INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)', [
			projectId,
			'integration-test-project',
			'/tmp/integration-test',
			null,
		])

		database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[sessionId, projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		// Parent run context
		const parentRunId = crypto.randomUUID()
		const parentRun: RunContext = {
			runId: parentRunId,
			parentRunId: undefined,
			depth: 0,
			agentType: 'orchestrator',
			title: 'Parent integration test run',
			sessionId,
			projectId,
			signal: new AbortController().signal,
		}

		// Seed parent run in database
		const createParentResult = createRun(database, {
			run_id: parentRunId,
			session_id: sessionId,
			project_id: projectId,
			parent_run_id: null,
			agent_type: 'orchestrator',
			title: 'Parent integration test run',
			status: 'running',
			context_mode: 'none',
		})
		if (!createParentResult.ok) {
			throw new Error(`Failed to seed parent run: ${createParentResult.error.message}`)
		}

		// Mock SSE manager to capture published events
		const publishedEvents: Array<{
			projectId: string
			sessionId: string
			type: string
			data: unknown
		}> = []

		const sseManager = {
			publish: (projectId: string, sessionId: string, type: string, data: unknown): void => {
				publishedEvents.push({ projectId, sessionId, type, data })
			},
		}

		// Mock provider router (not used in this test since we mock the agent loop)
		const providerRouter = {} as Parameters<typeof runAgentLoop>[0]

		// Mock tool registry
		const toolRegistry = {
			getAll: () => [],
			execute: async () => ({ ok: true, data: '' }),
		}

		// Config manager with permissive limits
		const configManager = {
			resolve: async () => ({
				ok: true,
				data: { maxTaskDepth: 10, maxChildren: 10 },
			}),
		}

		const runRegistry = new RunRegistry()
		const hookRegistry = new HookRegistry()

		// Build deps for task tool
		const taskDeps = {
			database,
			runRegistry,
			sseManager,
			providerRouter,
			hookRegistry,
			configManager,
			toolRegistry,
			currentRun: parentRun,
		}

		// Build deps for agent_session_search tool
		const searchDeps = {
			database,
			currentRun: parentRun,
		}

		return {
			database,
			projectId,
			sessionId,
			parentRunId,
			taskDeps,
			searchDeps,
			publishedEvents,
		}
	}

	async function mockAgentLoopWithEvents(events: MockAgentLoopEvent[]) {
		const agentLoopModule = await import('../../server/agent-loop.js')
		return spyOn(agentLoopModule, 'runAgentLoop').mockImplementation(
			async function* (
				_router: unknown,
				_registry: unknown,
				_params: unknown,
			): AsyncGenerator<MockAgentLoopEvent> {
				for (const event of events) {
					yield event as MockAgentLoopEvent
				}
			},
		)
	}

	it('end-to-end: synchronous task → message persistence → agent_session_search query', async () => {
		const harness = setupTestHarness()

		// Mock the agent loop to simulate a child run that produces messages
		const mockSpy = await mockAgentLoopWithEvents([
			{ type: 'text_delta', text: 'Hello' },
			{ type: 'text_delta', text: ' from' },
			{ type: 'text_delta', text: ' the' },
			{ type: 'text_delta', text: ' child' },
			{ type: 'text_delta', text: ' agent!' },
			{ type: 'done' },
		])

		// Step 1: Execute the task tool synchronously
		const taskTool = createTaskTool(harness.taskDeps)
		const taskResult = await taskTool.execute({
			description: 'test task',
			prompt: 'say hello',
			agent_type: 'general',
		})

		// Assert: Task returned successfully
		expect(taskResult.ok).toBe(true)
		if (!taskResult.ok) {
			throw new Error(`Task failed: ${taskResult.error.message}`)
		}

		// Parse the rich result
		const taskPayload = JSON.parse(taskResult.data) as {
			runId: string
			status: string
			agentType: string
			parentRunId: string
			durationMs: number
			result: {
				finalMessage: string
				toolCallSummary: Array<{ tool: string; count: number }>
			}
		}

		// Assert: Result structure matches expected format
		expect(taskPayload.status).toBe('done')
		expect(taskPayload.agentType).toBe('general')
		expect(taskPayload.parentRunId).toBe(harness.parentRunId)
		expect(typeof taskPayload.runId).toBe('string')
		expect(taskPayload.runId.length).toBeGreaterThan(0)
		expect(taskPayload.durationMs).toBeGreaterThanOrEqual(0)

		// Assert: Rich result contains finalMessage and toolCallSummary
		expect(taskPayload.result).not.toBeNull()
		expect(taskPayload.result.finalMessage).toBe('Hello from the child agent!')
		expect(Array.isArray(taskPayload.result.toolCallSummary)).toBe(true)
		expect(taskPayload.result.toolCallSummary).toEqual([])

		const childRunId = taskPayload.runId

		// Step 2: Query the persisted messages using agent_session_search
		const searchTool = createAgentSessionSearchTool(harness.searchDeps)
		const searchResult = await searchTool.execute({
			run_id: childRunId,
		})

		// Assert: Search returned successfully
		expect(searchResult.ok).toBe(true)
		if (!searchResult.ok) {
			throw new Error(`Search failed: ${searchResult.error.message}`)
		}

		// Parse search response
		const searchPayload = JSON.parse(searchResult.data) as {
			messages: Array<{
				seq: number
				role: string
				content_preview: string
				tool_name: string | null
				created_at: number
			}>
			total: number
			run_id: string
		}

		// Assert: Search returned messages
		expect(searchPayload.run_id).toBe(childRunId)
		expect(searchPayload.total).toBeGreaterThan(0)
		expect(Array.isArray(searchPayload.messages)).toBe(true)
		expect(searchPayload.messages.length).toBeGreaterThan(0)

		// Assert: Messages include the user prompt and assistant response
		const userMessage = searchPayload.messages.find((m) => m.role === 'user')
		expect(userMessage).toBeDefined()
		expect(userMessage?.content_preview).toContain('say hello')

		const assistantMessage = searchPayload.messages.find((m) => m.role === 'assistant')
		expect(assistantMessage).toBeDefined()
		expect(assistantMessage?.content_preview).toBe('Hello from the child agent!')

		// Assert: Messages are ordered by seq
		for (let i = 1; i < searchPayload.messages.length; i++) {
			expect(searchPayload.messages[i].seq).toBeGreaterThan(searchPayload.messages[i - 1].seq)
		}

		// Cleanup
		mockSpy.mockRestore()
		harness.database.close()
	})

	it('end-to-end: task with tool calls produces correct toolCallSummary', async () => {
		const harness = setupTestHarness()

		// Mock the agent loop to simulate a child run that uses tools
		const mockSpy = await mockAgentLoopWithEvents([
			{ type: 'text_delta', text: 'I will search for files' },
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-1', name: 'search_files', arguments: { query: 'test' } },
			},
			{
				type: 'tool_result',
				toolResult: { toolCallId: 'call-1', content: 'Found 3 files' },
			},
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-2', name: 'read_file', arguments: { path: '/tmp/test.txt' } },
			},
			{
				type: 'tool_result',
				toolResult: { toolCallId: 'call-2', content: 'File contents here' },
			},
			{
				type: 'tool_call_complete',
				toolCall: { id: 'call-3', name: 'search_files', arguments: { query: 'another' } },
			},
			{
				type: 'tool_result',
				toolResult: { toolCallId: 'call-3', content: 'Found 5 files' },
			},
			{ type: 'text_delta', text: 'Done searching!' },
			{ type: 'done' },
		])

		// Execute the task tool
		const taskTool = createTaskTool(harness.taskDeps)
		const taskResult = await taskTool.execute({
			description: 'tool test task',
			prompt: 'search and read',
			agent_type: 'researcher',
		})

		// Assert: Task returned successfully
		expect(taskResult.ok).toBe(true)
		if (!taskResult.ok) {
			throw new Error(`Task failed: ${taskResult.error.message}`)
		}

		const taskPayload = JSON.parse(taskResult.data) as {
			status: string
			result: {
				finalMessage: string
				toolCallSummary: Array<{ tool: string; count: number }>
			}
		}

		// Assert: Status is done
		expect(taskPayload.status).toBe('done')

		// Assert: Final message is correct
		expect(taskPayload.result.finalMessage).toBe('Done searching!')

		// Assert: Tool call summary shows correct counts
		expect(taskPayload.result.toolCallSummary).toEqual([
			{ tool: 'search_files', count: 2 },
			{ tool: 'read_file', count: 1 },
		])

		// Query messages and verify tool calls are persisted
		const searchTool = createAgentSessionSearchTool(harness.searchDeps)
		const searchResult = await searchTool.execute({
			run_id: JSON.parse(taskResult.data).runId,
			role: 'tool_call',
		})

		expect(searchResult.ok).toBe(true)
		if (!searchResult.ok) return

		const searchPayload = JSON.parse(searchResult.data) as {
			messages: Array<{ role: string; tool_name: string | null }>
			total: number
		}

		// Assert: Tool calls were persisted
		expect(searchPayload.total).toBe(3)
		expect(searchPayload.messages.filter((m) => m.tool_name === 'search_files').length).toBe(2)
		expect(searchPayload.messages.filter((m) => m.tool_name === 'read_file').length).toBe(1)

		// Cleanup
		mockSpy.mockRestore()
		harness.database.close()
	})

	it('end-to-end: cross-session search is denied', async () => {
		const harness = setupTestHarness()

		// Create a different session
		const otherSessionId = crypto.randomUUID()
		harness.database.db.run(
			'INSERT INTO sessions (id, project_id, workflow_id, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[otherSessionId, harness.projectId, null, 'execute', 'running', new Date().toISOString(), null],
		)

		// Create a run in the other session
		const otherRunId = crypto.randomUUID()
		createRun(harness.database, {
			run_id: otherRunId,
			session_id: otherSessionId,
			project_id: harness.projectId,
			parent_run_id: null,
			agent_type: 'general',
			title: 'Other session run',
			status: 'running',
			context_mode: 'none',
		})

		// Try to search the other session's run from the parent context
		const searchTool = createAgentSessionSearchTool(harness.searchDeps)
		const searchResult = await searchTool.execute({
			run_id: otherRunId,
		})

		// Assert: Cross-session search is denied
		expect(searchResult.ok).toBe(false)
		if (searchResult.ok) {
			throw new Error('Expected cross-session search to fail')
		}
		expect(searchResult.error.code).toBe('PERMISSION_DENIED')

		harness.database.close()
	})
})
