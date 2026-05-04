import { beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { SessionTodoTracker, sessionTodoTracker, type TodoItem } from './session-todos.ts'
import { mountSessionTodosRoute } from './routes-session-todos.ts'

function makeItem(overrides: Partial<TodoItem> = {}): TodoItem {
	return {
		id: crypto.randomUUID(),
		content: 'Test task',
		status: 'pending',
		priority: 'high',
		position: 0,
		...overrides,
	}
}

describe('SessionTodoTracker', () => {
	let tracker: SessionTodoTracker

	beforeEach(() => {
		tracker = new SessionTodoTracker()
	})

	it('getTodos returns empty array for unknown session', () => {
		expect(tracker.getTodos('nonexistent')).toEqual([])
	})

	it('updateTodos stores and getTodos retrieves', () => {
		const items = [makeItem({ content: 'Task 1' }), makeItem({ content: 'Task 2' })]
		tracker.updateTodos('session-1', items)
		expect(tracker.getTodos('session-1')).toEqual(items)
	})

	it('updateTodos replaces existing list', () => {
		const first = [makeItem({ content: 'Old' })]
		const second = [makeItem({ content: 'New' })]
		tracker.updateTodos('session-1', first)
		tracker.updateTodos('session-1', second)
		expect(tracker.getTodos('session-1')).toHaveLength(1)
		expect(tracker.getTodos('session-1')[0].content).toBe('New')
	})

	it('sessions are isolated', () => {
		const a = [makeItem({ content: 'Session A' })]
		const b = [makeItem({ content: 'Session B' })]
		tracker.updateTodos('a', a)
		tracker.updateTodos('b', b)
		expect(tracker.getTodos('a')[0].content).toBe('Session A')
		expect(tracker.getTodos('b')[0].content).toBe('Session B')
	})

	it('clearSession removes todos', () => {
		tracker.updateTodos('session-1', [makeItem()])
		tracker.clearSession('session-1')
		expect(tracker.getTodos('session-1')).toEqual([])
	})

	it('clearSession of unknown session is a no-op', () => {
		expect(() => tracker.clearSession('nonexistent')).not.toThrow()
	})

	it('getTodos returns the live array reference (callers should not mutate)', () => {
		const items = [makeItem()]
		tracker.updateTodos('s', items)
		const retrieved = tracker.getTodos('s')
		expect(retrieved).toHaveLength(1)
		// Note: Map.get returns the stored reference, so mutations do propagate
		retrieved.push(makeItem())
		expect(tracker.getTodos('s')).toHaveLength(2)
	})

	it('all status values are accepted', () => {
		for (const status of ['pending', 'in_progress', 'completed', 'cancelled'] as const) {
			tracker.updateTodos('s', [makeItem({ status })])
			expect(tracker.getTodos('s')[0].status).toBe(status)
		}
	})

	it('all priority values are accepted', () => {
		for (const priority of ['high', 'medium', 'low'] as const) {
			tracker.updateTodos('s', [makeItem({ priority })])
			expect(tracker.getTodos('s')[0].priority).toBe(priority)
		}
	})
})

describe('mountSessionTodosRoute', () => {
	let app: Elysia

	beforeEach(() => {
		app = new Elysia()

		// Seed tracker state directly
		sessionTodoTracker.clearSession('sess-a')
		sessionTodoTracker.clearSession('sess-b')
		sessionTodoTracker.updateTodos('sess-a', [
			makeItem({ id: '1', content: 'Todo 1', status: 'in_progress' }),
			makeItem({ id: '2', content: 'Todo 2', status: 'completed' }),
		])

		mountSessionTodosRoute(app)
	})

	it('returns todos for a session that has them', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/projects/p1/sessions/sess-a/todos'),
		)
		expect(response.status).toBe(200)
		const body = await response.json() as { todos: TodoItem[] }
		expect(body.todos).toHaveLength(2)
		expect(body.todos[0].content).toBe('Todo 1')
		expect(body.todos[0].status).toBe('in_progress')
		expect(body.todos[1].content).toBe('Todo 2')
		expect(body.todos[1].status).toBe('completed')
	})

	it('returns empty array for session with no todos', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/projects/p1/sessions/sess-b/todos'),
		)
		expect(response.status).toBe(200)
		const body = await response.json() as { todos: TodoItem[] }
		expect(body.todos).toEqual([])
	})

	it('returns empty array for unknown session', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/projects/p1/sessions/unknown/todos'),
		)
		expect(response.status).toBe(200)
		const body = await response.json() as { todos: TodoItem[] }
		expect(body.todos).toEqual([])
	})

	it('projectId in path does not affect result', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/projects/different-project/sessions/sess-a/todos'),
		)
		expect(response.status).toBe(200)
		const body = await response.json() as { todos: TodoItem[] }
		expect(body.todos).toHaveLength(2)
	})

	it('returns correct status and priority fields', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/projects/p1/sessions/sess-a/todos'),
		)
		const body = await response.json() as { todos: TodoItem[] }
		expect(body.todos[0].id).toBeString()
		expect(body.todos[0].content).toBeString()
		expect(['pending', 'in_progress', 'completed', 'cancelled']).toContain(body.todos[0].status)
		if (body.todos[0].priority) {
			expect(['high', 'medium', 'low']).toContain(body.todos[0].priority)
		}
	})
})

describe('singleton sessionTodoTracker', () => {
	it('is a SessionTodoTracker instance', () => {
		expect(sessionTodoTracker).toBeInstanceOf(SessionTodoTracker)
	})

	it('is a singleton — same reference on multiple accesses', () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const secondImport = require('./session-todos.ts') as {
			sessionTodoTracker: SessionTodoTracker
		}
		expect(secondImport.sessionTodoTracker).toBe(sessionTodoTracker)
	})
})
