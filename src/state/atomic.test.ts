import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteJson } from './atomic.ts';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'elefant-state-atomic-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('atomicWriteJson', () => {
  it('writes JSON atomically to target path', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'state.json');

    atomicWriteJson(filePath, { version: 2, ready: true });

    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      version: number;
      ready: boolean;
    };
    expect(parsed.version).toBe(2);
    expect(parsed.ready).toBe(true);
  });

  it('preserves original file when rename fails', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'state.json');
    writeFileSync(filePath, JSON.stringify({ version: 1, stable: true }), 'utf-8');

    expect(() => {
      atomicWriteJson(
        filePath,
        { version: 2, stable: false },
        {
          mkdirSync,
          writeFileSync,
          renameSync: () => {
            throw new Error('rename failed');
          },
          unlinkSync,
        },
      );
    }).toThrow('rename failed');

    const after = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      version: number;
      stable: boolean;
    };
    expect(after).toEqual({ version: 1, stable: true });

    const leftovers = readdirSync(dir).filter((entry) =>
      entry.startsWith('state.json.tmp.'),
    );
    expect(leftovers).toEqual([]);
  });
});
