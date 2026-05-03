import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RESEARCH_SECTIONS, researchBaseDir } from '../project/paths.js';
import { assertInsideResearchBase } from './membership.js';
import { ensureResearchBase } from './init.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'elefant-research-init-'));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

describe('ensureResearchBase', () => {
  test('creates all 8 sections with README stubs', () => {
    const project = tempProject();
    const result = ensureResearchBase(project);
    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error(result.error.message);

    const base = researchBaseDir(project);
    expect(existsSync(base)).toBe(true);
    for (const section of RESEARCH_SECTIONS) {
      const dir = join(base, section);
      const readme = join(dir, 'README.md');
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(readme)).toBe(true);
      const content = readFileSync(readme, 'utf8');
      expect(content).toContain(`# ${section}`);
      expect(content).toContain('<!-- managed-by: writer-agent -->');
      const guard = assertInsideResearchBase(project, readme, { requireMarkdown: true });
      expect(guard.ok).toBe(true);
    }

    cleanup(project);
  });

  test('creates root README and INDEX stubs', () => {
    const project = tempProject();
    const result = ensureResearchBase(project);
    expect(result.ok).toBe(true);
    const base = researchBaseDir(project);
    expect(readFileSync(join(base, 'README.md'), 'utf8')).toContain('Research Base');
    expect(readFileSync(join(base, 'INDEX.md'), 'utf8')).toContain('Research Index');
    cleanup(project);
  });

  test('is idempotent and second call reports everything as existing', () => {
    const project = tempProject();
    const first = ensureResearchBase(project);
    expect(first.ok).toBe(true);
    if (first.ok === false) throw new Error(first.error.message);
    expect(first.data.created.length).toBeGreaterThan(0);

    const second = ensureResearchBase(project);
    expect(second.ok).toBe(true);
    if (second.ok === false) throw new Error(second.error.message);
    expect(second.data.created).toHaveLength(0);
    expect(second.data.existed).toContain(researchBaseDir(project));
    for (const section of RESEARCH_SECTIONS) {
      expect(second.data.existed).toContain(join(researchBaseDir(project), section));
      expect(second.data.existed).toContain(join(researchBaseDir(project), section, 'README.md'));
    }
    expect(second.data.existed).toContain(join(researchBaseDir(project), 'README.md'));
    expect(second.data.existed).toContain(join(researchBaseDir(project), 'INDEX.md'));
    cleanup(project);
  });
});
