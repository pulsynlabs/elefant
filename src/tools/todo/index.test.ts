/**
 * Tests for todo tools (todowrite and todoread).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { todowriteTool, todoreadTool, type TodoWriteParams, type TodoReadParams } from './index.js';
import { setTodos, getTodos, type Todo } from './store.js';
import { formatTodos } from './format.js';
import type { ElefantError } from '../../types/errors.js';

/**
 * Helper to assert that a result is an error and return the error.
 * Works around TypeScript's discriminated union narrowing limitations in tests.
 */
function assertError<T>(result: { ok: true; data: T } | { ok: false; error: ElefantError }): ElefantError {
  if (result.ok) {
    throw new Error('Expected error but got success');
  }
  // Type assertion needed because TypeScript doesn't narrow after throw in all contexts
  return (result as { ok: false; error: ElefantError }).error;
}

describe('todo tools', () => {
  // Reset store before each test
  beforeEach(() => {
    // Clear all stored todos by writing empty arrays
    // We need to access the module-level store - use setTodos to clear
    setTodos('default', []);
    setTodos('conv-1', []);
    setTodos('conv-2', []);
  });

  describe('todowrite', () => {
    it('happy path: stores todos and returns formatted output', async () => {
      const params: TodoWriteParams = {
        todos: [
          { content: 'First task', status: 'pending', priority: 'high' },
          { content: 'Second task', status: 'in_progress', priority: 'medium' },
        ],
      };

      const result = await todowriteTool.execute(params);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain('[ ] First task (!)');
        expect(result.data).toContain('[~] Second task (\u00b7)');
      }
    });

    it('invalid status returns VALIDATION_ERROR', async () => {
      const params: TodoWriteParams = {
        todos: [
          { content: 'Valid task', status: 'pending', priority: 'high' },
          { content: 'Invalid task', status: 'invalid_status' as Todo['status'], priority: 'medium' },
        ],
      };

      const result = await todowriteTool.execute(params);
      const error = assertError(result);

      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toContain('Invalid status: invalid_status');
    });

    it('invalid priority returns VALIDATION_ERROR', async () => {
      const params: TodoWriteParams = {
        todos: [
          { content: 'Valid task', status: 'pending', priority: 'high' },
          { content: 'Invalid task', status: 'pending', priority: 'urgent' as Todo['priority'] },
        ],
      };

      const result = await todowriteTool.execute(params);
      const error = assertError(result);

      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toContain('Invalid priority: urgent');
    });

    it('empty content returns VALIDATION_ERROR', async () => {
      const params: TodoWriteParams = {
        todos: [
          { content: 'Valid task', status: 'pending', priority: 'high' },
          { content: '', status: 'pending', priority: 'medium' },
        ],
      };

      const result = await todowriteTool.execute(params);
      const error = assertError(result);

      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toBe('Todo content must be a non-empty string');
    });

    it('whitespace-only content returns VALIDATION_ERROR', async () => {
      const params: TodoWriteParams = {
        todos: [
          { content: '   ', status: 'pending', priority: 'high' },
        ],
      };

      const result = await todowriteTool.execute(params);
      const error = assertError(result);

      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toBe('Todo content must be a non-empty string');
    });

    it('uses default conversationId when not provided', async () => {
      const params: TodoWriteParams = {
        todos: [{ content: 'Default conv task', status: 'pending', priority: 'low' }],
      };

      await todowriteTool.execute(params);

      // Verify via direct store access
      const stored = getTodos('default');
      expect(stored).toHaveLength(1);
      expect(stored[0]!.content).toBe('Default conv task');
    });

    it('uses provided conversationId', async () => {
      const params: TodoWriteParams = {
        todos: [{ content: 'Custom conv task', status: 'completed', priority: 'high' }],
        conversationId: 'my-conversation',
      };

      await todowriteTool.execute(params);

      // Verify via direct store access
      const stored = getTodos('my-conversation');
      expect(stored).toHaveLength(1);
      expect(stored[0]!.content).toBe('Custom conv task');
    });
  });

  describe('todoread', () => {
    it('returns (no todos) when no list exists', async () => {
      const params: TodoReadParams = {};

      const result = await todoreadTool.execute(params);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('(no todos)');
      }
    });

    it('returns same content after todowrite', async () => {
      const writeParams: TodoWriteParams = {
        todos: [
          { content: 'Task A', status: 'pending', priority: 'high' },
          { content: 'Task B', status: 'in_progress', priority: 'low' },
        ],
        conversationId: 'test-conv',
      };

      await todowriteTool.execute(writeParams);

      const readParams: TodoReadParams = { conversationId: 'test-conv' };
      const result = await todoreadTool.execute(readParams);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain('[ ] Task A (!)');
        expect(result.data).toContain('[~] Task B (\u2193)');
      }
    });

    it('different conversationId values produce isolated lists', async () => {
      // Write to conv-1
      await todowriteTool.execute({
        todos: [{ content: 'Conv 1 task', status: 'pending', priority: 'high' }],
        conversationId: 'conv-1',
      });

      // Read from conv-2 should return empty
      const result = await todoreadTool.execute({ conversationId: 'conv-2' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('(no todos)');
      }

      // Read from conv-1 should return the task
      const result1 = await todoreadTool.execute({ conversationId: 'conv-1' });
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.data).toContain('Conv 1 task');
      }
    });

    it('uses default conversationId when not provided', async () => {
      // Write with explicit default
      await todowriteTool.execute({
        todos: [{ content: 'Default task', status: 'completed', priority: 'medium' }],
        conversationId: 'default',
      });

      // Read without providing conversationId
      const result = await todoreadTool.execute({});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain('Default task');
      }
    });
  });

  describe('formatTodos', () => {
    it('renders correct glyphs for all status/priority combinations', () => {
      const todos: Todo[] = [
        { content: 'Pending high', status: 'pending', priority: 'high' },
        { content: 'Pending medium', status: 'pending', priority: 'medium' },
        { content: 'Pending low', status: 'pending', priority: 'low' },
        { content: 'In progress high', status: 'in_progress', priority: 'high' },
        { content: 'In progress medium', status: 'in_progress', priority: 'medium' },
        { content: 'In progress low', status: 'in_progress', priority: 'low' },
        { content: 'Completed high', status: 'completed', priority: 'high' },
        { content: 'Completed medium', status: 'completed', priority: 'medium' },
        { content: 'Completed low', status: 'completed', priority: 'low' },
        { content: 'Cancelled high', status: 'cancelled', priority: 'high' },
        { content: 'Cancelled medium', status: 'cancelled', priority: 'medium' },
        { content: 'Cancelled low', status: 'cancelled', priority: 'low' },
      ];

      const formatted = formatTodos(todos);

      // Pending: [ ]
      expect(formatted).toContain('[ ] Pending high (!)');
      expect(formatted).toContain('[ ] Pending medium (\u00b7)');
      expect(formatted).toContain('[ ] Pending low (\u2193)');

      // In progress: [~]
      expect(formatted).toContain('[~] In progress high (!)');
      expect(formatted).toContain('[~] In progress medium (\u00b7)');
      expect(formatted).toContain('[~] In progress low (\u2193)');

      // Completed: [x]
      expect(formatted).toContain('[x] Completed high (!)');
      expect(formatted).toContain('[x] Completed medium (\u00b7)');
      expect(formatted).toContain('[x] Completed low (\u2193)');

      // Cancelled: [/]
      expect(formatted).toContain('[/] Cancelled high (!)');
      expect(formatted).toContain('[/] Cancelled medium (\u00b7)');
      expect(formatted).toContain('[/] Cancelled low (\u2193)');
    });

    it('returns (no todos) for empty array', () => {
      const result = formatTodos([]);
      expect(result).toBe('(no todos)');
    });

    it('formats one todo per line', () => {
      const todos: Todo[] = [
        { content: 'First', status: 'pending', priority: 'high' },
        { content: 'Second', status: 'completed', priority: 'low' },
      ];

      const formatted = formatTodos(todos);
      const lines = formatted.split('\n');

      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('[ ] First (!)');
      expect(lines[1]).toBe('[x] Second (\u2193)');
    });
  });

  describe('store', () => {
    it('setTodos stores and getTodos retrieves', () => {
      const todos: Todo[] = [
        { content: 'Stored task', status: 'in_progress', priority: 'medium' },
      ];

      setTodos('test-key', todos);
      const retrieved = getTodos('test-key');

      expect(retrieved).toEqual(todos);
    });

    it('getTodos returns empty array for unknown key', () => {
      const result = getTodos('non-existent-key');
      expect(result).toEqual([]);
    });

    it('setTodos replaces existing list', () => {
      setTodos('replace-test', [{ content: 'Old', status: 'pending', priority: 'low' }]);
      setTodos('replace-test', [{ content: 'New', status: 'completed', priority: 'high' }]);

      const retrieved = getTodos('replace-test');
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]!.content).toBe('New');
    });
  });
});
