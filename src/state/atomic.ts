import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface AtomicFsOps {
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
  renameSync: typeof renameSync;
  unlinkSync: typeof unlinkSync;
}

const defaultFsOps: AtomicFsOps = {
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
};

export function atomicWriteJson(
  filePath: string,
  data: unknown,
  fsOps: AtomicFsOps = defaultFsOps,
): void {
  const dir = dirname(filePath);
  fsOps.mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;

  try {
    fsOps.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fsOps.renameSync(tmp, filePath);
  } catch (error) {
    try {
      fsOps.unlinkSync(tmp);
    } catch {
      // Ignore cleanup errors.
    }
    throw error;
  }
}
