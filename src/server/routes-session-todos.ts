import type { Elysia } from 'elysia'
import { sessionTodoTracker } from './session-todos.ts'

export function mountSessionTodosRoute(app: Elysia): void {
	app.get(
		'/api/projects/:projectId/sessions/:sessionId/todos',
		({ params }: { params: Record<string, string> }) => {
			const todos = sessionTodoTracker.getTodos(params.sessionId)
			return { todos }
		},
	)
}
