import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FIELD_NOTES_SECTIONS, fieldNotesDir } from '../project/paths.js';
import { assertInsideFieldNotes } from './membership.js';
import { ensureFieldNotes } from './init.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'elefant-research-init-'));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

describe('ensureFieldNotes', () => {
  test('creates all 8 sections with README stubs', () => {
    const project = tempProject();
    const result = ensureFieldNotes(project);
    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error(result.error.message);

    const base = fieldNotesDir(project);
    expect(existsSync(base)).toBe(true);
    for (const section of FIELD_NOTES_SECTIONS) {
      const dir = join(base, section);
      const readme = join(dir, 'README.md');
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(readme)).toBe(true);
      const content = readFileSync(readme, 'utf8');
      expect(content).toContain(`# ${section}`);
      expect(content).toContain('<!-- managed-by: writer-agent -->');
      const guard = assertInsideFieldNotes(project, readme, { requireMarkdown: true });
      expect(guard.ok).toBe(true);
    }

    cleanup(project);
  });

  test('creates root README and INDEX stubs', () => {
    const project = tempProject();
    const result = ensureFieldNotes(project);
    expect(result.ok).toBe(true);
    const base = fieldNotesDir(project);
    expect(readFileSync(join(base, 'README.md'), 'utf8')).toContain('Field Notes');
    expect(readFileSync(join(base, 'INDEX.md'), 'utf8')).toContain('Field Notes Index');
    cleanup(project);
  });

  test('is idempotent and second call reports everything as existing', () => {
    const project = tempProject();
    const first = ensureFieldNotes(project);
    expect(first.ok).toBe(true);
    if (first.ok === false) throw new Error(first.error.message);
    expect(first.data.created.length).toBeGreaterThan(0);

    const second = ensureFieldNotes(project);
    expect(second.ok).toBe(true);
    if (second.ok === false) throw new Error(second.error.message);
    expect(second.data.created).toHaveLength(0);
    expect(second.data.existed).toContain(fieldNotesDir(project));
    for (const section of FIELD_NOTES_SECTIONS) {
      expect(second.data.existed).toContain(join(fieldNotesDir(project), section));
      expect(second.data.existed).toContain(join(fieldNotesDir(project), section, 'README.md'));
    }
    expect(second.data.existed).toContain(join(fieldNotesDir(project), 'README.md'));
    expect(second.data.existed).toContain(join(fieldNotesDir(project), 'INDEX.md'));
    cleanup(project);
  });
});
