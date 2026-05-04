import { describe, expect, it, mock } from 'bun:test';

import type { LspClient } from './client.js';

// ---------------------------------------------------------------------------
// Test helpers — mock the LSP barrel so the lspTool calls our fake service
// ---------------------------------------------------------------------------

let mockClientForFile: LspClient | null | undefined = null;

mock.module('../../lsp/index.js', () => ({
  getLspService: () => ({
    getClientForFile: async (_filePath: string) => mockClientForFile,
  }),
}));

// Dynamic import so the mock is in place when the module resolves its deps
const mod = await import('./index.js');
const { lspTool } = mod;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lspTool', () => {
  it('returns BINARY_NOT_FOUND when no LSP client is available', async () => {
    mockClientForFile = null;

    const result = await lspTool.execute({
      operation: 'documentSymbol',
      filePath: '/tmp/example.ts',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BINARY_NOT_FOUND');
      expect(result.error.message).toContain('LSP server not found');
    }
  });

  it('returns BINARY_NOT_FOUND when getClientForFile returns undefined', async () => {
    mockClientForFile = undefined;

    const result = await lspTool.execute({
      operation: 'documentSymbol',
      filePath: '/tmp/example.ts',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BINARY_NOT_FOUND');
      expect(result.error.message).toContain('LSP server not found');
    }
  });

  it('formats go-to-definition locations', async () => {
    const mockLspClient = {
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

    mockClientForFile = mockLspClient;

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
    const mockLspClient = {
      goToDefinition: mock(async () => []),
      findReferences: mock(async () => []),
      hover: mock(async () => '```ts\nconst value: string\n```'),
      documentSymbols: mock(async () => []),
      workspaceSymbols: mock(async () => []),
    } as unknown as LspClient;

    mockClientForFile = mockLspClient;

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
