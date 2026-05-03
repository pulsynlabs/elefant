import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertInsideResearchBase } from './membership.js';

function setupProject(extraDirs?: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'elefant-membership-'));
  const db = join(root, '.elefant', 'markdown-db');
  mkdirSync(db, { recursive: true });
  if (extraDirs) {
    for (const d of extraDirs) {
      mkdirSync(join(db, d), { recursive: true });
    }
  }
  return root;
}

function teardownProject(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe('assertInsideResearchBase', () => {
  let projectRoot: string;

  test('accepts a valid .md file inside a section', () => {
    projectRoot = setupProject(['02-tech']);
    const file = join(projectRoot, '.elefant', 'markdown-db', '02-tech', 'foo.md');
    writeFileSync(file, '# Test');

    const result = assertInsideResearchBase(projectRoot, file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(realpathSync(file));
    }

    teardownProject(projectRoot);
  });

  test('accepts a path relative to project root', () => {
    projectRoot = setupProject(['02-tech']);
    const relativeToProject = '.elefant/markdown-db/02-tech/foo.md';
    const file = join(projectRoot, '.elefant', 'markdown-db', '02-tech', 'foo.md');
    writeFileSync(file, '# Test');

    const result = assertInsideResearchBase(projectRoot, relativeToProject);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(realpathSync(file));
    }

    teardownProject(projectRoot);
  });

  test('rejects .. traversal escape', () => {
    projectRoot = setupProject();
    const escapePath = join(projectRoot, '.elefant', 'markdown-db', '..', 'escape.md');

    const result = assertInsideResearchBase(projectRoot, escapePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.message).toContain('escapes');
    }

    teardownProject(projectRoot);
  });

  test('rejects relative .. traversal from a section', () => {
    projectRoot = setupProject(['02-tech']);
    const escapePath = join(
      projectRoot,
      '.elefant',
      'markdown-db',
      '02-tech',
      '..',
      '..',
      'escape.md',
    );

    const result = assertInsideResearchBase(projectRoot, escapePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }

    teardownProject(projectRoot);
  });

  test('rejects absolute path outside the research base', () => {
    projectRoot = setupProject();
    const outside = join(tmpdir(), 'totally-outside.md');
    writeFileSync(outside, '# Nope');

    const result = assertInsideResearchBase(projectRoot, outside);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }

    rmSync(outside, { force: true });
    teardownProject(projectRoot);
  });

  test('rejects symlink escape to outside the base', () => {
    projectRoot = setupProject(['02-tech']);

    const outsideTarget = join(tmpdir(), 'evil.md');
    writeFileSync(outsideTarget, '# Bad target');

    const symlinkPath = join(
      projectRoot,
      '.elefant',
      'markdown-db',
      '02-tech',
      'evil-symlink.md',
    );

    try {
      symlinkSync(outsideTarget, symlinkPath);
    } catch {
      // symlink creation may fail on platforms without privileges (Windows)
      rmSync(outsideTarget, { force: true });
      teardownProject(projectRoot);
      return; // skip — test.environment doesn't support symlinks
    }

    const result = assertInsideResearchBase(projectRoot, symlinkPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }

    rmSync(outsideTarget, { force: true });
    teardownProject(projectRoot);
  });

  test('rejects symlink inside base that escapes via .. relative symlink', () => {
    projectRoot = setupProject(['02-tech']);

    // Create a symlink: .elefant/markdown-db/02-tech/esc -> ../../outside.md
    const outsideTarget = join(projectRoot, 'outside.md');
    writeFileSync(outsideTarget, '# Outside');

    const symlinkPath = join(
      projectRoot,
      '.elefant',
      'markdown-db',
      '02-tech',
      'escape-link.md',
    );

    // Use a relative symlink that climbs out
    try {
      symlinkSync('../../../outside.md', symlinkPath);
    } catch {
      rmSync(outsideTarget, { force: true });
      teardownProject(projectRoot);
      return;
    }

    const result = assertInsideResearchBase(projectRoot, symlinkPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }

    rmSync(outsideTarget, { force: true });
    teardownProject(projectRoot);
  });

  test('rejects non-.md file outside 99-scratch/ when requireMarkdown=true', () => {
    projectRoot = setupProject(['02-tech']);
    const file = join(projectRoot, '.elefant', 'markdown-db', '02-tech', 'data.json');
    writeFileSync(file, '{"key": 1}');

    const result = assertInsideResearchBase(projectRoot, file, {
      requireMarkdown: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('must end in .md');
    }

    teardownProject(projectRoot);
  });

  test('rejects non-.md file outside 99-scratch/ but relative path', () => {
    projectRoot = setupProject(['02-tech']);
    const file = join(projectRoot, '.elefant', 'markdown-db', '02-tech', 'data.txt');
    writeFileSync(file, 'hello');

    const result = assertInsideResearchBase(
      projectRoot,
      '.elefant/markdown-db/02-tech/data.txt',
      { requireMarkdown: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }

    teardownProject(projectRoot);
  });

  test('accepts non-.md file inside 99-scratch/ when requireMarkdown=true', () => {
    projectRoot = setupProject(['99-scratch']);
    const file = join(projectRoot, '.elefant', 'markdown-db', '99-scratch', 'notes.txt');
    writeFileSync(file, 'scratch notes');

    const result = assertInsideResearchBase(projectRoot, file, {
      requireMarkdown: true,
    });
    expect(result.ok).toBe(true);

    teardownProject(projectRoot);
  });

  test('accepts .py file inside 99-scratch/ when requireMarkdown=true', () => {
    projectRoot = setupProject(['99-scratch']);
    const file = join(projectRoot, '.elefant', 'markdown-db', '99-scratch', 'script.py');
    writeFileSync(file, 'print("ok")');

    const result = assertInsideResearchBase(projectRoot, file, {
      requireMarkdown: true,
    });
    expect(result.ok).toBe(true);

    teardownProject(projectRoot);
  });

  test('accepts .md file inside 99-scratch/ when requireMarkdown=true', () => {
    projectRoot = setupProject(['99-scratch']);
    const file = join(projectRoot, '.elefant', 'markdown-db', '99-scratch', 'draft.md');
    writeFileSync(file, '# Draft');

    const result = assertInsideResearchBase(projectRoot, file, {
      requireMarkdown: true,
    });
    expect(result.ok).toBe(true);

    teardownProject(projectRoot);
  });

  test('accepts .md file in a non-scratch section when requireMarkdown=true', () => {
    projectRoot = setupProject(['05-references']);
    const file = join(
      projectRoot,
      '.elefant',
      'markdown-db',
      '05-references',
      'ref.md',
    );
    writeFileSync(file, '# Ref');

    const result = assertInsideResearchBase(projectRoot, file, {
      requireMarkdown: true,
    });
    expect(result.ok).toBe(true);

    teardownProject(projectRoot);
  });

  test('accepts non-.md file when requireMarkdown is not set', () => {
    projectRoot = setupProject(['02-tech']);
    const file = join(projectRoot, '.elefant', 'markdown-db', '02-tech', 'data.json');
    writeFileSync(file, '{}');

    const result = assertInsideResearchBase(projectRoot, file);
    expect(result.ok).toBe(true);

    teardownProject(projectRoot);
  });

  test('rejects candidate that is exactly the research base directory', () => {
    projectRoot = setupProject();
    const basePath = join(projectRoot, '.elefant', 'markdown-db');

    const result = assertInsideResearchBase(projectRoot, basePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('not equal to it');
    }

    teardownProject(projectRoot);
  });

  test('rejects empty string candidate', () => {
    projectRoot = setupProject();

    const result = assertInsideResearchBase(projectRoot, '');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('empty');
    }

    teardownProject(projectRoot);
  });

  test('rejects whitespace-only candidate', () => {
    projectRoot = setupProject();

    const result = assertInsideResearchBase(projectRoot, '   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }

    teardownProject(projectRoot);
  });

  test('rejects a path that resolves to a directory outside via symlink parent', () => {
    projectRoot = setupProject();

    // Create a symlink that itself is inside the base but its parent
    // directory was reached via a chain of symlinks
    const outsideTarget = join(tmpdir(), 'outside-file.md');
    writeFileSync(outsideTarget, '# Outside');

    // Create a real dir inside base, then symlink it outside
    const dirInside = join(projectRoot, '.elefant', 'markdown-db', '02-tech');
    mkdirSync(dirInside, { recursive: true });

    const symlinkPath = join(dirInside, 'escape.md');

    try {
      symlinkSync(outsideTarget, symlinkPath);
    } catch {
      rmSync(outsideTarget, { force: true });
      teardownProject(projectRoot);
      return;
    }

    const result = assertInsideResearchBase(projectRoot, symlinkPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }

    rmSync(outsideTarget, { force: true });
    teardownProject(projectRoot);
  });

  test('accepts a not-yet-existing file path inside the base', () => {
    projectRoot = setupProject(['02-tech']);
    // File doesn't exist yet but the parent directory does
    const candidate = join(projectRoot, '.elefant', 'markdown-db', '02-tech', 'future.md');

    const result = assertInsideResearchBase(projectRoot, candidate);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(resolve(candidate));
    }

    teardownProject(projectRoot);
  });

  test('rejects a not-yet-existing path that escapes via .. traversal', () => {
    projectRoot = setupProject(['02-tech']);
    // File doesn't exist, but the resolved path escapes
    const candidate = join(
      projectRoot,
      '.elefant',
      'markdown-db',
      '02-tech',
      '..',
      '..',
      'new-escape.md',
    );

    const result = assertInsideResearchBase(projectRoot, candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }

    teardownProject(projectRoot);
  });

  test('rejects path with .elefant/markdown-db-evil prefix attack', () => {
    projectRoot = setupProject(['02-tech']);
    // Create an evil-suffixed directory to verify prefix+sep check
    const evilDir = join(projectRoot, '.elefant', 'markdown-db-evil');
    mkdirSync(evilDir, { recursive: true });
    const evilFile = join(evilDir, 'payload.md');
    writeFileSync(evilFile, '# Attack');

    const result = assertInsideResearchBase(projectRoot, evilFile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }

    teardownProject(projectRoot);
  });
});
