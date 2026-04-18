import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import type { LspClient } from './client.js';
import { lspTool } from './index.js';
import * as manager from './manager.js';

describe('lspTool', () => {
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = process.env.ELEFANT_EXPERIMENTAL_LSP;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.ELEFANT_EXPERIMENTAL_LSP;
    } else {
      process.env.ELEFANT_EXPERIMENTAL_LSP = originalFlag;
    }
    mock.restore();
  });

  it('returns err when experimental flag is not set', async () => {
    delete process.env.ELEFANT_EXPERIMENTAL_LSP;

    const result = await lspTool.execute({
      operation: 'hover',
      filePath: '/tmp/example.ts',
      position: { line: 0, character: 0 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOOL_EXECUTION_FAILED');
      expect(result.error.message).toContain('ELEFANT_EXPERIMENTAL_LSP=true');
    }
  });

  it('returns BINARY_NOT_FOUND when manager returns null', async () => {
    process.env.ELEFANT_EXPERIMENTAL_LSP = 'true';
    const getClientSpy = spyOn(manager, 'getClient').mockResolvedValue(null);

    const result = await lspTool.execute({
      operation: 'documentSymbol',
      filePath: '/tmp/example.ts',
    });

    expect(getClientSpy).toHaveBeenCalledWith('typescript');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BINARY_NOT_FOUND');
      expect(result.error.message).toBe('LSP server not found. Install typescript-language-server.');
    }
  });

  it('formats go-to-definition locations', async () => {
    process.env.ELEFANT_EXPERIMENTAL_LSP = 'true';

    const mockClient = {
      goToDefinition: mock(async () => [
        {
          uri: 'file:///home/james/Documents/elefant/src/tools/read.ts',
          range: {
            start: { line: 41, character: 9 },
            end: { line: 41, character: 13 },
          },
        },
      ]),
      findReferences: mock(async () => []),
      hover: mock(async () => null),
      documentSymbols: mock(async () => []),
      workspaceSymbols: mock(async () => []),
    } as unknown as LspClient;

    spyOn(manager, 'getClient').mockResolvedValue(mockClient);

    const result = await lspTool.execute({
      operation: 'goToDefinition',
      filePath: '/home/james/Documents/elefant/src/tools/read.ts',
      position: { line: 0, character: 0 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('src/tools/read.ts:42:10');
    }
  });

  it('formats hover response text', async () => {
    process.env.ELEFANT_EXPERIMENTAL_LSP = 'true';

    const mockClient = {
      goToDefinition: mock(async () => []),
      findReferences: mock(async () => []),
      hover: mock(async () => '```ts\nconst value: string\n```'),
      documentSymbols: mock(async () => []),
      workspaceSymbols: mock(async () => []),
    } as unknown as LspClient;

    spyOn(manager, 'getClient').mockResolvedValue(mockClient);

    const result = await lspTool.execute({
      operation: 'hover',
      filePath: '/home/james/Documents/elefant/src/tools/read.ts',
      position: { line: 0, character: 0 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('const value: string');
    }
  });
});

describe('lsp manager cache', () => {
  afterEach(() => {
    manager.clearClientCache();
    manager.__resetManagerTestOverrides();
  });

  it('returns cached client instance on repeated lookups', async () => {
    let spawnCount = 0;
    const kill = mock(() => {});

    manager.__setManagerTestOverrides({
      which: () => '/usr/bin/typescript-language-server',
      spawn: () => {
        spawnCount += 1;
        return {
          stdin: new WritableStream<Uint8Array>(),
          stdout: new ReadableStream<Uint8Array>(),
          stderr: new ReadableStream<Uint8Array>(),
          kill,
        } as unknown as ReturnType<typeof Bun.spawn>;
      },
    });

    const initializeSpy = spyOn((await import('./client.js')).LspClient.prototype, 'initialize').mockResolvedValue(undefined);

    const first = await manager.getClient('typescript');
    const second = await manager.getClient('typescript');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).toBe(second);
    expect(spawnCount).toBe(1);
    expect(initializeSpy).toHaveBeenCalledTimes(1);
  });
});
