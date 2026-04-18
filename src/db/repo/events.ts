import type { Database } from '../database.ts';
import type { Result } from '../../types/result.ts';
import { ok, err } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import {
  EventRowSchema,
  InsertEventSchema,
  type EventRow,
  type InsertEvent,
} from '../schema.ts';

export function insertEvent(
  db: Database,
  input: InsertEvent,
): Result<EventRow, ElefantError> {
  const parsed = InsertEventSchema.safeParse(input);
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
      'INSERT INTO events (id, session_id, type, data, timestamp) VALUES (?, ?, ?, ?, ?)',
      [data.id, data.session_id, data.type, data.data ?? '{}', data.timestamp ?? new Date().toISOString()],
    );
    return getEventById(db, data.id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function getEventById(
  db: Database,
  id: string,
): Result<EventRow, ElefantError> {
  try {
    const row = db.db.query('SELECT * FROM events WHERE id = ?').get(id);
    if (!row) {
      return err({
        code: 'FILE_NOT_FOUND',
        message: `Event ${id} not found`,
      });
    }
    return ok(EventRowSchema.parse(row));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function listEventsBySession(
  db: Database,
  sessionId: string,
): Result<EventRow[], ElefantError> {
  try {
    const rows = db.db
      .query(
        'SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC',
      )
      .all(sessionId);
    return ok(rows.map((r) => EventRowSchema.parse(r)));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function listEventsByType(
  db: Database,
  sessionId: string,
  type: string,
): Result<EventRow[], ElefantError> {
  try {
    const rows = db.db
      .query(
        'SELECT * FROM events WHERE session_id = ? AND type = ? ORDER BY timestamp ASC',
      )
      .all(sessionId, type);
    return ok(rows.map((r) => EventRowSchema.parse(r)));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function deleteEvent(
  db: Database,
  id: string,
): Result<void, ElefantError> {
  try {
    db.db.run('DELETE FROM events WHERE id = ?', [id]);
    return ok(undefined);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}
