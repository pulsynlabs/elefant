/**
 * Todo formatting — render todos as human-readable text with glyphs.
 */

import type { Todo } from './store.js';

/**
 * Format a single todo with status glyph and priority marker.
 */
function formatTodo(todo: Todo): string {
  // Status glyphs
  const statusGlyph: Record<Todo['status'], string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[/]',
  };

  // Priority markers
  const priorityMarker: Record<Todo['priority'], string> = {
    high: ' (!)',
    medium: ' (\u00b7)', // middle dot
    low: ' (\u2193)', // down arrow
  };

  return `${statusGlyph[todo.status]} ${todo.content}${priorityMarker[todo.priority]}`;
}

/**
 * Format an array of todos as a string.
 * Returns "(no todos)" if array is empty.
 */
export function formatTodos(todos: Todo[]): string {
  if (todos.length === 0) {
    return '(no todos)';
  }

  return todos.map(formatTodo).join('\n');
}
