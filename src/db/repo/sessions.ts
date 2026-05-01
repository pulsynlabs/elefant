import type { Database } from '../database.ts';
import type { Result } from '../../types/result.ts';
import { ok, err } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import {
  SessionRowSchema,
  InsertSessionSchema,
  UpdateSessionSchema,
  type SessionRow,
  type InsertSession,
  type UpdateSession,
} from '../schema.ts';

export function insertSession(
  db: Database,
  input: InsertSession,
): Result<SessionRow, ElefantError> {
  const parsed = InsertSessionSchema.safeParse(input);
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
      'INSERT INTO sessions (id, project_id, workflow_id, mode, phase, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        data.id,
        data.project_id,
        data.workflow_id ?? null,
        data.mode ?? 'quick',
        data.phase ?? 'idle',
        data.status ?? 'pending',
        data.started_at ?? new Date().toISOString(),
        data.completed_at ?? null,
      ],
    );
    return getSessionById(db, data.id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function getSessionById(
  db: Database,
  id: string,
): Result<SessionRow, ElefantError> {
  try {
    const row = db.db.query('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!row) {
      return err({
        code: 'FILE_NOT_FOUND',
        message: `Session ${id} not found`,
      });
    }
    return ok(SessionRowSchema.parse(row));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function listSessionsByProject(
  db: Database,
  projectId: string,
  limit = 10,
): Result<SessionRow[], ElefantError> {
  try {
    const rows = db.db
      .query(
        'SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?',
      )
      .all(projectId, limit);
    return ok(rows.map((r) => SessionRowSchema.parse(r)));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function updateSession(
  db: Database,
  input: UpdateSession,
): Result<SessionRow, ElefantError> {
  const parsed = UpdateSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'VALIDATION_ERROR',
      message: parsed.error.message,
      details: parsed.error,
    });
  }
  const { id, ...fields } = parsed.data;

  // Mode is immutable — reject any attempt to change it after creation.
  if ('mode' in fields) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'Session mode is immutable and cannot be changed after creation.',
    });
  }

  const setClauses = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  if (!setClauses) return getSessionById(db, id);
  try {
    db.db.run(
      `UPDATE sessions SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...Object.values(fields), id],
    );
    return getSessionById(db, id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function deleteSession(
  db: Database,
  id: string,
): Result<void, ElefantError> {
  try {
    db.db.run('DELETE FROM sessions WHERE id = ?', [id]);
    return ok(undefined);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}
