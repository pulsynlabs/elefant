import { afterEach, describe, expect, test } from 'bun:test';
import { createOpenAiProvider } from './openai.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('openai embedding provider', () => {
  test('requires apiKey and defaults to text-embedding-3-small', async () => {
    expect(createOpenAiProvider({ name: 'openai' }).ok).toBe(false);
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe('https://api.openai.com/v1/embeddings');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'text-embedding-3-small', input: ['a'] });
      return Response.json({ data: [{ embedding: [1, 2, 3] }] });
    }) as unknown as typeof fetch;
    const provider = createOpenAiProvider({ name: 'openai', apiKey: 'sk-test' });
    if (!provider.ok) throw new Error('provider config failed');
    expect(provider.data.dim()).toBe(1536);
    const result = await provider.data.embed(['a']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.dim).toBe(3);
  });

  test('respects Retry-After for one 429 retry', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })
        : Response.json({ data: [{ embedding: [1] }] });
    }) as unknown as typeof fetch;
    const provider = createOpenAiProvider({ name: 'openai', apiKey: 'sk' });
    if (!provider.ok) throw new Error('provider config failed');
    expect((await provider.data.embed(['x'])).ok).toBe(true);
    expect(calls).toBe(2);
  });
});
