import { afterEach, describe, expect, test } from 'bun:test';
import { createVllmProvider } from './vllm.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('vllm embedding provider', () => {
  test('requires baseUrl', () => {
    expect(createVllmProvider({ name: 'vllm' }).ok).toBe(false);
  });

  test('posts OpenAI-compatible embeddings to baseUrl', async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe('http://localhost:8000/v1/embeddings');
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'custom', input: ['a'] });
      return Response.json({ data: [{ embedding: [1, 2, 3, 4] }] });
    }) as unknown as typeof fetch;
    const provider = createVllmProvider({ name: 'vllm', baseUrl: 'http://localhost:8000', model: 'custom' });
    if (!provider.ok) throw new Error('provider config failed');
    const result = await provider.data.embed(['a']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.dim).toBe(4);
  });
});
