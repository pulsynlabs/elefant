import type { Database } from '../database.ts';
import type { Result } from '../../types/result.ts';
import { ok, err } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import {
  ProjectRowSchema,
  InsertProjectSchema,
  UpdateProjectSchema,
  type ProjectRow,
  type InsertProject,
  type UpdateProject,
} from '../schema.ts';

export function insertProject(
  db: Database,
  input: InsertProject,
): Result<ProjectRow, ElefantError> {
  const parsed = InsertProjectSchema.safeParse(input);
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
      'INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)',
      [data.id, data.name, data.path, data.description ?? null],
    );
    return getProjectById(db, data.id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function getProjectById(
  db: Database,
  id: string,
): Result<ProjectRow, ElefantError> {
  try {
    const row = db.db.query('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) {
      return err({
        code: 'FILE_NOT_FOUND',
        message: `Project ${id} not found`,
      });
    }
    return ok(ProjectRowSchema.parse(row));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function getProjectByPath(
  db: Database,
  path: string,
): Result<ProjectRow | null, ElefantError> {
  try {
    const row = db.db.query('SELECT * FROM projects WHERE path = ?').get(path);
    if (!row) return ok(null);
    return ok(ProjectRowSchema.parse(row));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function listProjects(db: Database): Result<ProjectRow[], ElefantError> {
  try {
    const rows = db.db
      .query('SELECT * FROM projects ORDER BY updated_at DESC')
      .all();
    return ok(rows.map((r) => ProjectRowSchema.parse(r)));
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function updateProject(
  db: Database,
  input: UpdateProject,
): Result<ProjectRow, ElefantError> {
  const parsed = UpdateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'VALIDATION_ERROR',
      message: parsed.error.message,
      details: parsed.error,
    });
  }
  const { id, ...fields } = parsed.data;
  const setClauses = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  if (!setClauses) return getProjectById(db, id);
  try {
    db.db.run(
      `UPDATE projects SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...Object.values(fields), id],
    );
    return getProjectById(db, id);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}

export function deleteProject(
  db: Database,
  id: string,
): Result<void, ElefantError> {
  try {
    db.db.run('DELETE FROM projects WHERE id = ?', [id]);
    return ok(undefined);
  } catch (e) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: String(e),
      details: e,
    });
  }
}
