import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  clearServeAuth,
  getServeAuthPath,
  loadServeAuth,
  writeServeAuth,
} from './serve-auth.ts';

const originalHome = process.env.HOME;
let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(path.join(tmpdir(), 'elefant-serve-auth-home-'));
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  rmSync(tempHome, { recursive: true, force: true });
});

describe('serve auth credentials', () => {
  it('writes hashed credentials without plaintext and with 0600 permissions', async () => {
    const result = await writeServeAuth('alice', 'secret');
    expect(result.ok).toBe(true);

    const authPath = getServeAuthPath();
    expect(existsSync(authPath)).toBe(true);

    const raw = readFileSync(authPath, 'utf8');
    expect(raw).toContain('passwordHash');
    expect(raw).not.toContain('secret');

    const data = JSON.parse(raw) as { username: string; passwordHash: string };
    expect(data.username).toBe('alice');
    expect(data.passwordHash).toBeTruthy();

    const mode = statSync(authPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('loads credentials after write and verifies the password hash', async () => {
    const writeResult = await writeServeAuth('alice', 'secret');
    expect(writeResult.ok).toBe(true);

    const loadResult = await loadServeAuth();
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) {
      throw new Error(loadResult.error.message);
    }

    expect(loadResult.data.username).toBe('alice');
    expect(loadResult.data.passwordHash).not.toBe('');
    expect(await Bun.password.verify('secret', loadResult.data.passwordHash)).toBe(true);
  });

  it('clears credentials and then returns FILE_NOT_FOUND on load', async () => {
    const writeResult = await writeServeAuth('alice', 'secret');
    expect(writeResult.ok).toBe(true);

    const clearResult = await clearServeAuth();
    expect(clearResult.ok).toBe(true);
    expect(existsSync(getServeAuthPath())).toBe(false);

    const loadResult = await loadServeAuth();
    expect(loadResult.ok).toBe(false);
    if (!loadResult.ok) {
      expect(loadResult.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('roundtrip: write then load verifies username, password hash, and no plaintext (NFR9)', async () => {
    const writeResult = await writeServeAuth('bob', 'hunter2');
    expect(writeResult.ok).toBe(true);

    const loadResult = await loadServeAuth();
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) throw new Error(loadResult.error.message);

    expect(loadResult.data.username).toBe('bob');
    expect(await Bun.password.verify('hunter2', loadResult.data.passwordHash)).toBe(true);

    const authPath = getServeAuthPath();
    const raw = readFileSync(authPath, 'utf8');
    expect(raw).not.toContain('hunter2');
  });
});
