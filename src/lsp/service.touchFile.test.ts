import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

import { LspClient } from '../tools/lsp/client.js';
import { LspService } from './service.js';
import type { Handle, ServerInfo } from './types.js';

type ServiceInternals = {
  diagnosticsEmitter: EventEmitter;
};

function createMockProcess(): ReturnType<typeof Bun.spawn> {
  return {
    stdin: new WritableStream<Uint8Array>(),
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    kill: mock(() => {}),
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function makeMockServer(id: string, extensions: string[], opts?: {
  rootResult?: string;
  spawnResult?: Handle | undefined;
  spawnDelayMs?: number;
}): ServerInfo {
  return {
    id,
    extensions,
    root: async () => opts && 'rootResult' in opts ? opts.rootResult : '/mock/root',
    spawn: async () => {
      if (opts?.spawnDelayMs) {
        await Bun.sleep(opts.spawnDelayMs);
      }
      return opts && 'spawnResult' in opts ? opts.spawnResult : { process: createMockProcess() };
    },
  };
}

async function withTempFile(contents: string, extension = '.ts'): Promise<{ dir: string; filePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'elefant-lsp-touch-'));
  const filePath = join(dir, `example${extension}`);
  await writeFile(filePath, contents, 'utf8');
  return { dir, filePath };
}

afterEach(() => {
  mock.restore();
});

describe('LspService.touchFile', () => {
  it('resolves without error for unsupported extensions', async () => {
    const server = makeMockServer('typescript', ['.ts']);
    const service = new LspService([server]);

    await expect(service.touchFile('/tmp/example.unsupported')).resolves.toBeUndefined();
  });

  it('resolves without error when root detection fails', async () => {
    const server = makeMockServer('typescript', ['.ts'], { rootResult: undefined });
    const service = new LspService([server]);

    await expect(service.touchFile('/tmp/example.ts')).resolves.toBeUndefined();
  });

  it('resolves without error when the server binary is missing', async () => {
    const server = makeMockServer('typescript', ['.ts'], { spawnResult: undefined });
    const service = new LspService([server]);

    await expect(service.touchFile('/tmp/example.ts')).resolves.toBeUndefined();
  });

  it('calls didChange with disk contents before didSave', async () => {
    const { dir, filePath } = await withTempFile('const value = 42;');
    const order: string[] = [];
    const initializeSpy = spyOn(LspClient.prototype, 'initialize').mockResolvedValue(undefined);
    const didChangeSpy = spyOn(LspClient.prototype, 'didChange').mockImplementation(async (_filePath, _text) => {
      order.push('didChange');
    });
    const didSaveSpy = spyOn(LspClient.prototype, 'didSave').mockImplementation(async () => {
      order.push('didSave');
    });

    try {
      const service = new LspService([makeMockServer('typescript', ['.ts'])]);

      await service.touchFile(filePath);

      expect(initializeSpy).toHaveBeenCalledWith('file:///mock/root');
      expect(didChangeSpy).toHaveBeenCalledWith(filePath, 'const value = 42;');
      expect(didSaveSpy).toHaveBeenCalledWith(filePath);
      expect(order).toEqual(['didChange', 'didSave']);
      await service.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not wait for diagnostics when waitForDiagnostics is false', async () => {
    const { dir, filePath } = await withTempFile('const value = 1;');
    spyOn(LspClient.prototype, 'initialize').mockResolvedValue(undefined);
    spyOn(LspClient.prototype, 'didChange').mockResolvedValue(undefined);
    spyOn(LspClient.prototype, 'didSave').mockResolvedValue(undefined);

    try {
      const service = new LspService([makeMockServer('typescript', ['.ts'])]);
      const startedAt = performance.now();

      await service.touchFile(filePath, false);

      expect(performance.now() - startedAt).toBeLessThan(500);
      await service.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves diagnostics wait when diagnostics arrive for the file path', async () => {
    const { dir, filePath } = await withTempFile('const value: number = "broken";');
    spyOn(LspClient.prototype, 'initialize').mockResolvedValue(undefined);
    spyOn(LspClient.prototype, 'didChange').mockResolvedValue(undefined);
    spyOn(LspClient.prototype, 'didSave').mockResolvedValue(undefined);

    try {
      const service = new LspService([makeMockServer('typescript', ['.ts'])]);
      const startedAt = performance.now();
      const promise = service.touchFile(filePath, true);

      setTimeout(() => {
        (service as unknown as ServiceInternals).diagnosticsEmitter.emit('diagnostics', filePath);
      }, 25);

      await promise;

      const elapsed = performance.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(1000);
      await service.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves diagnostics wait after the hard cap when no diagnostics arrive', async () => {
    const { dir, filePath } = await withTempFile('const value = 1;');
    spyOn(LspClient.prototype, 'initialize').mockResolvedValue(undefined);
    spyOn(LspClient.prototype, 'didChange').mockResolvedValue(undefined);
    spyOn(LspClient.prototype, 'didSave').mockResolvedValue(undefined);

    try {
      const service = new LspService([makeMockServer('typescript', ['.ts'])]);
      const startedAt = performance.now();

      await service.touchFile(filePath, true);

      const elapsed = performance.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(2900);
      expect(elapsed).toBeLessThan(3500);
      await service.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 5000);

  it('deduplicates concurrent spawn attempts for the same server root', async () => {
    const { dir, filePath } = await withTempFile('const value = 1;');
    let spawnCount = 0;
    spyOn(LspClient.prototype, 'initialize').mockResolvedValue(undefined);
    spyOn(LspClient.prototype, 'didChange').mockResolvedValue(undefined);
    spyOn(LspClient.prototype, 'didSave').mockResolvedValue(undefined);

    const server: ServerInfo = {
      id: 'typescript',
      extensions: ['.ts'],
      root: async () => '/mock/root',
      spawn: async () => {
        spawnCount += 1;
        await Bun.sleep(25);
        return { process: createMockProcess() };
      },
    };

    try {
      const service = new LspService([server]);

      await Promise.all([
        service.touchFile(filePath),
        service.touchFile(filePath),
      ]);

      expect(spawnCount).toBe(1);
      await service.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
