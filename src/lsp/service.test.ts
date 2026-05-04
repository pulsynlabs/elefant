import { afterEach, describe, expect, it } from 'bun:test';

import { createLspService, getLspService, LspService, resetLspService } from './service.js';

afterEach(() => {
  resetLspService();
});

describe('LspService', () => {
  it('constructs with the default server registry', () => {
    expect(() => new LspService()).not.toThrow();
  });

  it('constructs with an empty server list', () => {
    expect(() => new LspService([])).not.toThrow();
  });

  it('resolves touchFile without throwing while stubbed', async () => {
    const service = new LspService([]);

    await expect(service.touchFile('/tmp/example.ts')).resolves.toBeUndefined();
    await expect(service.touchFile('/tmp/example.ts', true)).resolves.toBeUndefined();
  });

  it('returns an empty diagnostics snapshot when no diagnostics are stored', async () => {
    const service = new LspService([]);

    await expect(service.diagnostics()).resolves.toEqual({});
  });

  it('resolves dispose without throwing', async () => {
    const service = new LspService([]);

    await expect(service.dispose()).resolves.toBeUndefined();
  });

  it('returns the same singleton instance on repeated getLspService calls', () => {
    const first = getLspService();
    const second = getLspService();

    expect(second).toBe(first);
  });

  it('replaces the singleton when createLspService is called', () => {
    const original = getLspService();
    const replacement = createLspService([]);

    expect(replacement).not.toBe(original);
    expect(getLspService()).toBe(replacement);
  });

  it('clears the singleton when resetLspService is called', () => {
    const original = getLspService();

    resetLspService();
    const next = getLspService();

    expect(next).not.toBe(original);
  });
});
