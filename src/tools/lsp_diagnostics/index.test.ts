import { describe, test, expect, mock } from 'bun:test';
import type { LspDiagnostic } from '../../lsp/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function diag(
  message: string,
  overrides: Partial<LspDiagnostic> = {},
): LspDiagnostic {
  return {
    range: {
      start: { line: overrides.range?.start.line ?? 2, character: 5 },
      end: { line: overrides.range?.end.line ?? 2, character: 12 },
    },
    severity: 1,
    message,
    ...overrides,
  };
}

let store: Record<string, LspDiagnostic[]>;
let shouldThrow = false;

// Mock the LSP barrel before the tool module is imported
mock.module('../../lsp/index.js', () => ({
  getLspService: () => {
    if (shouldThrow) {
      throw new Error('LSP service crashed');
    }
    return {
      diagnostics: async () => structuredClone(store),
      getDiagnosticsFor: (f: string) => (store[f] ? [...store[f]] : []),
    };
  },
}));

// Dynamic import so the mock is in place when the module resolves its deps
const mod = await import('./index.js');
const { lspDiagnosticsTool } = mod;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lsp_diagnostics tool', () => {
  test('returns No diagnostics when the LSP store is empty', async () => {
    store = {};
    const result = await lspDiagnosticsTool.execute({});
    expect(result).toEqual({ ok: true, data: 'No diagnostics.' });
  });

  test('returns diagnostics for two files, sorted alphabetically', async () => {
    store = {
      '/project/src/b.ts': [diag('Error in b')],
      '/project/src/a.ts': [diag('Error in a')],
    };
    const result = await lspDiagnosticsTool.execute({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const lines = result.data.split('\n');
    expect(lines).toHaveLength(2);
    // Sorted by file path: a.ts before b.ts
    expect(lines[0]).toContain('/project/src/a.ts');
    expect(lines[1]).toContain('/project/src/b.ts');
    expect(lines[0]).toContain('Error in a');
    expect(lines[1]).toContain('Error in b');
  });

  test('filePath param scopes to a single file', async () => {
    store = {
      '/project/src/foo.ts': [diag('problem in foo')],
      '/project/src/bar.ts': [diag('problem in bar')],
    };
    const result = await lspDiagnosticsTool.execute({
      filePath: '/project/src/foo.ts',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.data).toContain('foo.ts');
    expect(result.data).toContain('problem in foo');
    expect(result.data).not.toContain('bar.ts');
  });

  test('severity "error" filters out warnings', async () => {
    store = {
      '/project/src/file.ts': [
        diag('type error', { severity: 1 }),
        diag('unused variable', { severity: 2 }),
      ],
    };
    const result = await lspDiagnosticsTool.execute({ severity: 'error' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.data).toContain('type error');
    expect(result.data).not.toContain('unused variable');
  });

  test('severity "warning" shows only warnings', async () => {
    store = {
      '/project/src/file.ts': [
        diag('type error', { severity: 1 }),
        diag('unused variable', { severity: 2 }),
        diag('spelling hint', { severity: 4 }),
      ],
    };
    const result = await lspDiagnosticsTool.execute({ severity: 'warning' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.data).toContain('unused variable');
    expect(result.data).not.toContain('type error');
    expect(result.data).not.toContain('spelling hint');
  });

  test('severity "all" includes hints and information', async () => {
    store = {
      '/project/src/file.ts': [
        diag('type error', { severity: 1 }),
        diag('unused variable', { severity: 2 }),
        diag('info note', { severity: 3 }),
        diag('spelling hint', { severity: 4 }),
      ],
    };
    const result = await lspDiagnosticsTool.execute({ severity: 'all' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.data).toContain('type error');
    expect(result.data).toContain('unused variable');
    expect(result.data).toContain('info note');
    expect(result.data).toContain('spelling hint');
  });

  test('default severity filter is errors + warnings (excludes hints)', async () => {
    store = {
      '/project/src/file.ts': [
        diag('type error', { severity: 1 }),
        diag('unused variable', { severity: 2 }),
        diag('spelling hint', { severity: 4 }),
      ],
    };
    const result = await lspDiagnosticsTool.execute({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.data).toContain('type error');
    expect(result.data).toContain('unused variable');
    expect(result.data).not.toContain('spelling hint');
  });

  test('appends [code] when diagnostic code is present, omits when missing', async () => {
    store = {
      '/project/src/file.ts': [
        diag('typed error', { code: 'TS2322' }),
        diag('bare error'),
      ],
    };
    const result = await lspDiagnosticsTool.execute({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const lines = result.data.split('\n');
    const codedLine = lines.find((l) => l.includes('typed error'))!;
    const bareLine = lines.find((l) => l.includes('bare error'))!;

    expect(codedLine).toContain('[TS2322]');
    // The bare line should not have a stray "[undefined]" or bare brackets
    expect(bareLine).not.toMatch(/\s\[\d+\]$/);
    expect(bareLine).not.toMatch(/\[\]$/);
  });

  test('never throws — returns No diagnostics on service failure', async () => {
    shouldThrow = true;
    const result = await lspDiagnosticsTool.execute({});
    shouldThrow = false;
    expect(result).toEqual({ ok: true, data: 'No diagnostics.' });
  });

  test('output format per line: <filePath>:<line>:<col> — <severity>: <message> [<code>]', async () => {
    store = {
      '/project/main.ts': [
        diag('Cannot assign string to number', {
          range: {
            start: { line: 9, character: 14 },
            end: { line: 9, character: 22 },
          },
          severity: 1,
          code: 'TS2322',
        }),
      ],
    };
    const result = await lspDiagnosticsTool.execute({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    // Line/col are 1-based (LSP is 0-based)
    expect(result.data).toBe(
      '/project/main.ts:10:15 — error: Cannot assign string to number [TS2322]',
    );
  });
});
