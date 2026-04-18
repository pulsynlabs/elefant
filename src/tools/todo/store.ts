/**
 * Todo store — in-memory Map keyed by conversationId.
 * No disk persistence in this milestone.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface Todo {
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

// Module-level in-memory store
const store = new Map<string, Todo[]>();

/**
 * Store todos for a conversation.
 */
export function setTodos(conversationId: string, todos: Todo[]): void {
  store.set(conversationId, todos);
}

/**
 * Get todos for a conversation.
 * Returns empty array if no list exists.
 */
export function getTodos(conversationId: string): Todo[] {
  return store.get(conversationId) ?? [];
}
