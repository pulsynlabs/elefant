import { afterEach, describe, expect, test } from 'bun:test';
import { createGoogleProvider } from './google.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('google embedding provider', () => {
  test('requires apiKey', () => {
    expect(createGoogleProvider({ name: 'google' }).ok).toBe(false);
  });

  test('posts batchEmbedContents requests and detects dim', async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe('https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=key');
      expect(JSON.parse(String(init?.body))).toEqual({
        requests: [{ model: 'text-embedding-004', content: { parts: [{ text: 'hello' }] } }],
      });
      return Response.json({ embeddings: [{ values: [1, 2, 3] }] });
    }) as unknown as typeof fetch;
    const provider = createGoogleProvider({ name: 'google', apiKey: 'key' });
    if (!provider.ok) throw new Error('provider config failed');
    expect(provider.data.dim()).toBe(768);
    const result = await provider.data.embed(['hello']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.dim).toBe(3);
  });

  test('returns validation error for malformed responses', async () => {
    globalThis.fetch = (async () => Response.json({ embeddings: [{ vector: [1] }] })) as unknown as typeof fetch;
    const provider = createGoogleProvider({ name: 'google', apiKey: 'key' });
    if (!provider.ok) throw new Error('provider config failed');
    const result = await provider.data.embed(['hello']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});
