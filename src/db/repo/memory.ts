import type { Database } from '../database.ts';
import type { Result } from '../../types/result.ts';
import { ok, err } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import {
  MemoryEntryRowSchema,
  InsertMemoryEntrySchema,
  UpdateMemoryEntrySchema,
  type MemoryEntryRow,
  type InsertMemoryEntry,
  type UpdateMemoryEntry,
} from '../schema.ts';

export function insertMemoryEntry(
  db: Database,
  input: InsertMemoryEntry,
): Result<MemoryEntryRow, ElefantError> {
  const parsed = InsertMemoryEntrySchema.safeParse(input);
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
      'INSERT INTO memory_entries (type, title, content, importance, concepts, source_files, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        data.type ?? 'observation',
        data.title,
        data.content,
        data.importance ?? 5,
        data.concepts ?? '[]',
        data.source_files ?? '[]',
        data.created_at ?? Math.floor(Date.now() / 1000),
        data.updated_at ?? Math.floor(Date.now() / 1000),
      ],
    );
    const row = db.db
      .query('SELECT last_insert_rowid() as id')
      .get() as { id: number };
    return getMemoryEntryById(db, row.id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function getMemoryEntryById(
  db: Database,
  id: number,
): Result<MemoryEntryRow, ElefantError> {
  try {
    const row = db.db
      .query('SELECT * FROM memory_entries WHERE id = ?')
      .get(id);
    if (!row) {
      return err({
        code: 'FILE_NOT_FOUND',
        message: `Memory entry ${id} not found`,
      });
    }
    return ok(MemoryEntryRowSchema.parse(row));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export interface ListMemoryOptions {
  type?: string;
  limit?: number;
  minImportance?: number;
}

export function listMemoryEntries(
  db: Database,
  opts?: ListMemoryOptions,
): Result<MemoryEntryRow[], ElefantError> {
  try {
    let sql = 'SELECT * FROM memory_entries';
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (opts?.type) {
      conditions.push('type = ?');
      params.push(opts.type);
    }
    if (opts?.minImportance !== undefined) {
      conditions.push('importance >= ?');
      params.push(opts.minImportance);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ' ORDER BY importance DESC, created_at DESC';

    if (opts?.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    const rows = db.db.query(sql).all(...params);
    return ok(rows.map((r) => MemoryEntryRowSchema.parse(r)));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function updateMemoryEntry(
  db: Database,
  input: UpdateMemoryEntry,
): Result<MemoryEntryRow, ElefantError> {
  const parsed = UpdateMemoryEntrySchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'VALIDATION_ERROR',
      message: parsed.error.message,
      details: parsed.error,
    });
  }
  const { id, ...fields } = parsed.data;
  const setClauses = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  if (!setClauses) return getMemoryEntryById(db, id);
  try {
    db.db.run(
      `UPDATE memory_entries SET ${setClauses}, updated_at = unixepoch() WHERE id = ?`,
      [...Object.values(fields), id],
    );
    return getMemoryEntryById(db, id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function deleteMemoryEntry(
  db: Database,
  id: number,
): Result<void, ElefantError> {
  try {
    db.db.run('DELETE FROM memory_entries WHERE id = ?', [id]);
    return ok(undefined);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}
