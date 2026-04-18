import { describe, expect, test } from 'bun:test';
import {
  checkpointsDir,
  dbPath,
  elefantDir,
  logsDir,
  memoryDir,
  pluginsDir,
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
