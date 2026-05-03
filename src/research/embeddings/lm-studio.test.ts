import { afterEach, describe, expect, test } from 'bun:test';
import { createLmStudioProvider } from './lm-studio.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('lm-studio embedding provider', () => {
  test('posts native batches and detects dim', async () => {
    let requestBody: unknown;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe('http://localhost:1234/v1/embeddings');
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] });
    }) as unknown as typeof fetch;
    const provider = createLmStudioProvider({ name: 'lm-studio' });
    if (!provider.ok) throw new Error('provider config failed');
    const result = await provider.data.embed(['a', 'b']);
    expect(requestBody).toEqual({ model: 'text-embedding-nomic-embed-text-v1.5', input: ['a', 'b'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.dim).toBe(2);
  });

  test('retries one 5xx response', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1 ? new Response('error', { status: 502 }) : Response.json({ data: [{ embedding: [1] }] });
    }) as unknown as typeof fetch;
    const provider = createLmStudioProvider({ name: 'lm-studio' });
    if (!provider.ok) throw new Error('provider config failed');
    expect((await provider.data.embed(['x'])).ok).toBe(true);
    expect(calls).toBe(2);
  });

  test('reports dim lifecycle and wrong-sized batches cleanly', async () => {
    globalThis.fetch = (async () => Response.json({ data: [] })) as unknown as typeof fetch;
    const provider = createLmStudioProvider({ name: 'lm-studio' });
    if (!provider.ok) throw new Error('provider config failed');
    expect((await provider.data.init()).ok).toBe(true);
    expect(() => provider.data.dim()).toThrow('before successful embed');
    const result = await provider.data.embed(['missing']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_ERROR');
    await provider.data.dispose();
  });
});
