import { describe, expect, test } from 'bun:test';
import { createDisabledProvider } from './disabled.ts';

describe('disabled embedding provider', () => {
  test('is a local no-op provider', async () => {
    const provider = createDisabledProvider();
    expect(provider.name).toBe('disabled');
    expect(provider.isLocal).toBe(true);
    expect(await provider.init()).toEqual({ ok: true, data: undefined });
    expect(provider.dim()).toBe(0);
    const embedded = await provider.embed(['ignored']);
    expect(embedded.ok).toBe(true);
    if (embedded.ok) expect(embedded.data).toEqual({ vectors: [], dim: 0 });
  });
});
