import { afterEach, describe, expect, test } from 'bun:test';
import { createOllamaProvider } from './ollama.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('ollama embedding provider', () => {
  test('posts prompts, retries 5xx once, and detects dim', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      if (calls.length === 1) return new Response('server error', { status: 500 });
      return Response.json({ embedding: [0.1, 0.2, 0.3] });
    }) as unknown as typeof fetch;
    const providerResult = createOllamaProvider({ name: 'ollama' });
    expect(providerResult.ok).toBe(true);
    if (!providerResult.ok) return;
    const result = await providerResult.data.embed(['hello']);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ url: 'http://localhost:11434/api/embeddings', body: { model: 'nomic-embed-text', prompt: 'hello' } });
    expect(providerResult.data.dim()).toBe(3);
  });

  test('returns validation error for malformed responses', async () => {
    globalThis.fetch = (async () => Response.json({ vector: [1] })) as unknown as typeof fetch;
    const provider = createOllamaProvider({ name: 'ollama' });
    if (!provider.ok) throw new Error('provider config failed');
    const result = await provider.data.embed(['bad']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});
