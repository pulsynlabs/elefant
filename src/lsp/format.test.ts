import { describe, expect, it } from 'bun:test';

import { buildDiagnosticSuffix, pretty, report, reportOthers } from './format.js';
import type { LspDiagnostic } from './types.js';

function diag(
  overrides: Partial<LspDiagnostic> & { line: number; col?: number; message?: string },
): LspDiagnostic {
  return {
    range: {
      start: { line: overrides.line, character: overrides.col ?? 0 },
      end: { line: overrides.line, character: (overrides.col ?? 0) + 1 },
    },
    severity: overrides.severity,
    code: overrides.code,
    message: overrides.message ?? 'test message',
  };
}

describe('pretty', () => {
  it('formats severity labels for all four values and missing', () => {
    expect(pretty(diag({ line: 0, severity: 1, message: 'err' }))).toContain('- error: err');
    expect(pretty(diag({ line: 0, severity: 2, message: 'warn' }))).toContain('- warning: warn');
    expect(pretty(diag({ line: 0, severity: 3, message: 'info' }))).toContain('- information: info');
    expect(pretty(diag({ line: 0, severity: 4, message: 'hint' }))).toContain('- hint: hint');
    expect(pretty(diag({ line: 0, severity: undefined, message: 'defaults' }))).toContain(
      '- error: defaults',
    );
  });

  it('converts 0-based line and column to 1-based display', () => {
    const d = diag({ line: 4, col: 6, message: 'test' });
    // line=5, col=7
    expect(pretty(d)).toStartWith('  5:7 - ');
  });

  it('appends code suffix when code is present', () => {
    const d = diag({ line: 0, code: 2322, message: 'type error' });
    expect(pretty(d)).toEndWith(' [2322]');
  });

  it('omits code suffix when code is absent', () => {
    const d = diag({ line: 0, code: undefined, message: 'no code' });
    expect(pretty(d)).not.toContain('[');
  });

  it('truncates messages longer than 200 characters', () => {
    const long = 'x'.repeat(250);
    const d = diag({ line: 0, message: long });
    const out = pretty(d);
    expect(out).toEndWith('...');
    expect(out.length).toBeLessThan(long.length + 20); // reasonable bound
  });
});

describe('report', () => {
  it('returns undefined for an empty diagnostics array', () => {
    expect(report('/a.ts', [])).toBeUndefined();
  });

  it('includes the file path header', () => {
    const d = diag({ line: 0, severity: 1, message: 'error' });
    const out = report('/a/b.ts', [d]);
    expect(out).toStartWith('/a/b.ts:\n');
  });

  it('sorts errors before warnings', () => {
    const d1 = diag({ line: 10, severity: 2, message: 'late warning' });
    const d2 = diag({ line: 3, severity: 1, message: 'error' });
    const out = report('/f.ts', [d1, d2])!;
    const lines = out.split('\n');
    expect(lines[1]).toContain('error');
    expect(lines[2]).toContain('warning');
  });
});

describe('reportOthers', () => {
  it('excludes the current file', () => {
    const byFile = {
      '/a.ts': [diag({ line: 0, severity: 1, message: 'e' })],
      '/b.ts': [diag({ line: 0, severity: 1, message: 'e' })],
    };
    const out = reportOthers(byFile, '/a.ts');
    expect(out).toContain('/b.ts:');
    expect(out).not.toContain('/a.ts:');
  });

  it('caps at maxFiles', () => {
    const byFile: Record<string, LspDiagnostic[]> = {};
    for (let i = 0; i < 25; i++) {
      byFile[`/f${i}.ts`] = [diag({ line: 0, severity: 1, message: 'e' })];
    }
    const out = reportOthers(byFile, '/current.ts', 5);
    expect(out).not.toBeUndefined();
    // Should only report 5 files max
    const fileCount = (out!.match(/:\n/g) ?? []).length;
    expect(fileCount).toBe(5);
  });

  it('sorts files with errors before files with only warnings', () => {
    const byFile = {
      '/warn.ts': [diag({ line: 0, severity: 2, message: 'w' })],
      '/err.ts': [diag({ line: 0, severity: 1, message: 'e' })],
    };
    const out = reportOthers(byFile, '/current.ts');
    expect(out).not.toBeUndefined();
    const errIdx = out!.indexOf('/err.ts:');
    const warnIdx = out!.indexOf('/warn.ts:');
    expect(errIdx).toBeLessThan(warnIdx);
  });

  it('returns undefined when no other files have diagnostics', () => {
    const byFile = {
      '/a.ts': [diag({ line: 0, severity: 1, message: 'e' })],
    };
    expect(reportOthers(byFile, '/a.ts')).toBeUndefined();
  });
});

describe('buildDiagnosticSuffix', () => {
  it('returns empty string when there are no diagnostics', () => {
    expect(buildDiagnosticSuffix('/a.ts', {})).toBe('');
  });

  it('produces a current-file block when the current file has diagnostics', () => {
    const all: Record<string, LspDiagnostic[]> = {
      '/a.ts': [diag({ line: 0, severity: 1, message: 'type mismatch' })],
    };
    const out = buildDiagnosticSuffix('/a.ts', all);
    expect(out).toContain('LSP errors detected in this file, please fix:');
    expect(out).toContain('type mismatch');
    expect(out).not.toContain('other files');
  });

  it('produces an other-files block when other files have diagnostics', () => {
    const all: Record<string, LspDiagnostic[]> = {
      '/other.ts': [diag({ line: 0, severity: 1, message: 'oops' })],
    };
    const out = buildDiagnosticSuffix('/current.ts', all);
    expect(out).toContain('LSP errors detected in other files:');
    expect(out).toContain('oops');
    expect(out).not.toContain('this file');
  });

  it('includes both blocks when both current and other files have diagnostics', () => {
    const all: Record<string, LspDiagnostic[]> = {
      '/cur.ts': [diag({ line: 0, severity: 1, message: 'current err' })],
      '/oth.ts': [diag({ line: 0, severity: 2, message: 'other warn' })],
    };
    const out = buildDiagnosticSuffix('/cur.ts', all);
    expect(out).toContain('this file');
    expect(out).toContain('other files');
    expect(out).toContain('current err');
    expect(out).toContain('other warn');
  });
});
