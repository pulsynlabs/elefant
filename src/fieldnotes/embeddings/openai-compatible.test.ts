import { afterEach, describe, expect, test } from 'bun:test';
import { createOpenAiCompatibleProvider } from './openai-compatible.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('openai-compatible embedding provider', () => {
  test('requires baseUrl and model', () => {
    expect(createOpenAiCompatibleProvider({ name: 'openai-compatible', model: 'm' }).ok).toBe(false);
    expect(createOpenAiCompatibleProvider({ name: 'openai-compatible', baseUrl: 'https://example.com' }).ok).toBe(false);
  });

  test('supports optional apiKey and validates response shape', async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe('https://embed.example.com/v1/embeddings');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
      return Response.json({ data: [{ embedding: [5, 6] }] });
    }) as unknown as typeof fetch;
    const provider = createOpenAiCompatibleProvider({ name: 'openai-compatible', baseUrl: 'https://embed.example.com', apiKey: 'token', model: 'embed' });
    if (!provider.ok) throw new Error('provider config failed');
    expect((await provider.data.embed(['x'])).ok).toBe(true);
  });

  test('returns validation error for malformed responses', async () => {
    globalThis.fetch = (async () => Response.json({ data: [{ value: [1] }] })) as unknown as typeof fetch;
    const provider = createOpenAiCompatibleProvider({ name: 'openai-compatible', baseUrl: 'https://embed.example.com', model: 'embed' });
    if (!provider.ok) throw new Error('provider config failed');
    const result = await provider.data.embed(['x']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});
