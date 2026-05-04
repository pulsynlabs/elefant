/**
 * Session-scoped todo tracker.
 *
 * Distinct from src/tools/todo/store.ts which keys by conversationId (runId).
 * This tracker keys by sessionId so the Session Todos tab can surface todo
 * state that persists across multiple runs within a single session.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface TodoItem {
	id: string
	content: string
	status: TodoStatus
	priority?: 'high' | 'medium' | 'low'
	position?: number
}

export class SessionTodoTracker {
	private todos = new Map<string, TodoItem[]>()

	updateTodos(sessionId: string, items: TodoItem[]): void {
		this.todos.set(sessionId, items)
	}

	getTodos(sessionId: string): TodoItem[] {
		return this.todos.get(sessionId) ?? []
	}

	clearSession(sessionId: string): void {
		this.todos.delete(sessionId)
	}
}

export const sessionTodoTracker = new SessionTodoTracker()
