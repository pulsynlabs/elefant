import type { Database } from '../database.ts';
import type { Result } from '../../types/result.ts';
import { ok, err } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import {
  CheckpointRowSchema,
  InsertCheckpointSchema,
  type CheckpointRow,
  type InsertCheckpoint,
} from '../schema.ts';

export function insertCheckpoint(
  db: Database,
  input: InsertCheckpoint,
): Result<CheckpointRow, ElefantError> {
  const parsed = InsertCheckpointSchema.safeParse(input);
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
      'INSERT INTO checkpoints (id, session_id, data) VALUES (?, ?, ?)',
      [data.id, data.session_id, data.data ?? '{}'],
    );
    return getCheckpointById(db, data.id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function getCheckpointById(
  db: Database,
  id: string,
): Result<CheckpointRow, ElefantError> {
  try {
    const row = db.db.query('SELECT * FROM checkpoints WHERE id = ?').get(id);
    if (!row) {
      return err({
        code: 'FILE_NOT_FOUND',
        message: `Checkpoint ${id} not found`,
      });
    }
    return ok(CheckpointRowSchema.parse(row));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function listCheckpointsBySession(
  db: Database,
  sessionId: string,
): Result<CheckpointRow[], ElefantError> {
  try {
    const rows = db.db
      .query(
        'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC',
      )
      .all(sessionId);
    return ok(rows.map((r) => CheckpointRowSchema.parse(r)));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function deleteCheckpoint(
  db: Database,
  id: string,
): Result<void, ElefantError> {
  try {
    db.db.run('DELETE FROM checkpoints WHERE id = ?', [id]);
    return ok(undefined);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}
