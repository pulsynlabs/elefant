import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fieldNotesDir } from '../project/paths.ts';
import { FieldNotesWatcher } from './watcher.ts';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'elefant-indexer-'));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureBase(project: string): string {
  const dir = join(fieldNotesDir(project), '02-tech');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const maybeTest = Bun.env.CI ? test.skip : test;

describe('FieldNotesWatcher', () => {
  maybeTest('debounces rapid writes into one change callback', async () => {
    const project = tempProject();
    try {
      const dir = ensureBase(project);
      const file = join(dir, 'debounce.md');
      const changed: string[] = [];
      const watcher = new FieldNotesWatcher({
        projectPath: project,
        debounceMs: 40,
        onChanged: async (path) => { changed.push(path); },
        onRemoved: async () => undefined,
      });
      watcher.start();
      await wait(20);
      writeFileSync(file, 'one');
      writeFileSync(file, 'two');
      writeFileSync(file, 'three');
      await wait(180);
      watcher.stop();
      expect(changed).toHaveLength(1);
      expect(changed[0]).toBe(file);
    } finally {
      cleanup(project);
    }
  });

  maybeTest('file creation triggers onChanged', async () => {
    const project = tempProject();
    try {
      const dir = ensureBase(project);
      const file = join(dir, 'created.md');
      const changed: string[] = [];
      const watcher = new FieldNotesWatcher({ projectPath: project, debounceMs: 30, onChanged: async (path) => { changed.push(path); }, onRemoved: async () => undefined });
      watcher.start();
      await wait(20);
      writeFileSync(file, 'created');
      await wait(140);
      watcher.stop();
      expect(changed).toContain(file);
    } finally {
      cleanup(project);
    }
  });

  maybeTest('file deletion triggers onRemoved', async () => {
    const project = tempProject();
    try {
      const dir = ensureBase(project);
      const file = join(dir, 'removed.md');
      writeFileSync(file, 'remove me');
      const removed: string[] = [];
      const watcher = new FieldNotesWatcher({ projectPath: project, debounceMs: 30, onChanged: async () => undefined, onRemoved: async (path) => { removed.push(path); } });
      watcher.start();
      await wait(20);
      unlinkSync(file);
      await wait(140);
      watcher.stop();
      expect(removed).toContain(file);
    } finally {
      cleanup(project);
    }
  });

  maybeTest('stop prevents further callbacks', async () => {
    const project = tempProject();
    try {
      const dir = ensureBase(project);
      const file = join(dir, 'stopped.md');
      const changed: string[] = [];
      const watcher = new FieldNotesWatcher({ projectPath: project, debounceMs: 30, onChanged: async (path) => { changed.push(path); }, onRemoved: async () => undefined });
      watcher.start();
      watcher.stop();
      writeFileSync(file, 'no callback');
      await wait(120);
      expect(changed).toHaveLength(0);
    } finally {
      cleanup(project);
    }
  });
});
