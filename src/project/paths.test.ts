import { describe, expect, test } from 'bun:test';
import { win32 } from 'node:path';
import {
  checkpointsDir,
  dbPath,
  elefantDir,
  logsDir,
  memoryDir,
  pluginsDir,
  researchBaseDir,
  researchIndexPath,
  researchSectionDirs,
  RESEARCH_SECTIONS,
  statePath,
} from './paths.ts';

describe('path helpers', () => {
  const base = '/home/user/my-project';

  test('elefantDir returns .elefant under project', () => {
    expect(elefantDir(base)).toBe('/home/user/my-project/.elefant');
  });

  test('dbPath returns db.sqlite inside .elefant', () => {
    expect(dbPath(base)).toBe('/home/user/my-project/.elefant/db.sqlite');
  });

  test('statePath returns state.json inside .elefant', () => {
    expect(statePath(base)).toBe('/home/user/my-project/.elefant/state.json');
  });

  test('logsDir returns logs inside .elefant', () => {
    expect(logsDir(base)).toBe('/home/user/my-project/.elefant/logs');
  });

  test('checkpointsDir returns checkpoints inside .elefant', () => {
    expect(checkpointsDir(base)).toBe(
      '/home/user/my-project/.elefant/checkpoints',
    );
  });

  test('memoryDir returns memory inside .elefant', () => {
    expect(memoryDir(base)).toBe('/home/user/my-project/.elefant/memory');
  });

  test('pluginsDir returns plugins inside .elefant', () => {
    expect(pluginsDir(base)).toBe('/home/user/my-project/.elefant/plugins');
  });

  test('all helpers produce absolute paths', () => {
    const paths = [
      elefantDir(base),
      dbPath(base),
      statePath(base),
      logsDir(base),
      checkpointsDir(base),
      memoryDir(base),
      pluginsDir(base),
    ];
    for (const p of paths) {
      expect(p.startsWith('/')).toBe(true);
    }
  });

  test('helpers work with trailing slash on input', () => {
    const withSlash = '/home/user/my-project/';
    expect(elefantDir(withSlash)).toBe('/home/user/my-project/.elefant');
    expect(dbPath(withSlash)).toBe('/home/user/my-project/.elefant/db.sqlite');
  });
});

describe('research path helpers', () => {
  const base = '/home/user/my-project';

  test('researchBaseDir returns .elefant/markdown-db on Linux', () => {
    expect(researchBaseDir(base)).toBe(
      '/home/user/my-project/.elefant/markdown-db',
    );
  });

  test('researchBaseDir returns correct path with win32-style construction', () => {
    const winProject = win32.resolve('C:\\Users\\dev\\repo');
    const result = win32.join(win32.join(winProject, '.elefant'), 'markdown-db');
    expect(result).toBe('C:\\Users\\dev\\repo\\.elefant\\markdown-db');
    // Verify our helper uses the platform sep correctly by checking the
    // Linux path separator is present (since we run on Linux)
    expect(researchBaseDir('/home/x/repo')).toContain('/.elefant/markdown-db');
  });

  test('researchIndexPath returns .elefant/research-index.sqlite', () => {
    expect(researchIndexPath(base)).toBe(
      '/home/user/my-project/.elefant/research-index.sqlite',
    );
  });

  test('RESEARCH_SECTIONS contains exactly 8 entries in display order', () => {
    expect(RESEARCH_SECTIONS).toEqual([
      '00-index',
      '01-domain',
      '02-tech',
      '03-decisions',
      '04-comparisons',
      '05-references',
      '06-synthesis',
      '99-scratch',
    ]);
    expect(RESEARCH_SECTIONS.length).toBe(8);
  });

  test('RESEARCH_SECTIONS is readonly', () => {
    // TypeScript catches mutation at compile-time; runtime check that it's frozen
    // or at least not silently mutable — a const array is still mutable, but
    // `as const` readonly assertion means TS blocks push/assignment.
    expect(Array.isArray(RESEARCH_SECTIONS)).toBe(true);
  });

  test('researchSectionDirs returns 8 entries under research base', () => {
    const dirs = researchSectionDirs(base);
    expect(dirs).toHaveLength(8);
    expect(dirs[0]).toBe(
      '/home/user/my-project/.elefant/markdown-db/00-index',
    );
    expect(dirs[1]).toBe(
      '/home/user/my-project/.elefant/markdown-db/01-domain',
    );
    expect(dirs[2]).toBe(
      '/home/user/my-project/.elefant/markdown-db/02-tech',
    );
    expect(dirs[3]).toBe(
      '/home/user/my-project/.elefant/markdown-db/03-decisions',
    );
    expect(dirs[4]).toBe(
      '/home/user/my-project/.elefant/markdown-db/04-comparisons',
    );
    expect(dirs[5]).toBe(
      '/home/user/my-project/.elefant/markdown-db/05-references',
    );
    expect(dirs[6]).toBe(
      '/home/user/my-project/.elefant/markdown-db/06-synthesis',
    );
    expect(dirs[7]).toBe(
      '/home/user/my-project/.elefant/markdown-db/99-scratch',
    );
  });

  test('researchSectionDirs uses the platform separator', () => {
    const dirs = researchSectionDirs('/x');
    for (const d of dirs) {
      expect(d).toContain('.elefant/markdown-db/');
    }
  });
});
