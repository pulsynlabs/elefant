import type { Database } from '../database.ts';
import type { Result } from '../../types/result.ts';
import { ok, err } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import {
  WorkItemRowSchema,
  InsertWorkItemSchema,
  UpdateWorkItemSchema,
  type WorkItemRow,
  type InsertWorkItem,
  type UpdateWorkItem,
} from '../schema.ts';

export function insertWorkItem(
  db: Database,
  input: InsertWorkItem,
): Result<WorkItemRow, ElefantError> {
  const parsed = InsertWorkItemSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'VALIDATION_ERROR',
      message: parsed.error.message,
      details: parsed.error,
    });
  }
  const data = parsed.data;
  try {
    db.db.run(
      'INSERT INTO work_items (id, project_id, title, description, type, status, priority, tags, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        data.id,
        data.project_id,
        data.title,
        data.description ?? null,
        data.type ?? 'feature',
        data.status ?? 'todo',
        data.priority ?? 'medium',
        data.tags ?? '[]',
        data.order_index ?? 0,
      ],
    );
    return getWorkItemById(db, data.id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function getWorkItemById(
  db: Database,
  id: string,
): Result<WorkItemRow, ElefantError> {
  try {
    const row = db.db.query('SELECT * FROM work_items WHERE id = ?').get(id);
    if (!row) {
      return err({
        code: 'FILE_NOT_FOUND',
        message: `Work item ${id} not found`,
      });
    }
    return ok(WorkItemRowSchema.parse(row));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function listWorkItemsByProject(
  db: Database,
  projectId: string,
): Result<WorkItemRow[], ElefantError> {
  try {
    const rows = db.db
      .query(
        'SELECT * FROM work_items WHERE project_id = ? ORDER BY order_index ASC, created_at DESC',
      )
      .all(projectId);
    return ok(rows.map((r) => WorkItemRowSchema.parse(r)));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function updateWorkItem(
  db: Database,
  input: UpdateWorkItem,
): Result<WorkItemRow, ElefantError> {
  const parsed = UpdateWorkItemSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'VALIDATION_ERROR',
      message: parsed.error.message,
      details: parsed.error,
    });
  }
  const { id, ...fields } = parsed.data;
  const setClauses = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  if (!setClauses) return getWorkItemById(db, id);
  try {
    db.db.run(
      `UPDATE work_items SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...Object.values(fields), id],
    );
    return getWorkItemById(db, id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function deleteWorkItem(
  db: Database,
  id: string,
): Result<void, ElefantError> {
  try {
    db.db.run('DELETE FROM work_items WHERE id = ?', [id]);
    return ok(undefined);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}
