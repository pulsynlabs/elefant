import { describe, expect, test } from 'bun:test';
import { EmbeddingProviderNameSchema, createEmbeddingProvider } from './provider.ts';
import type { EmbeddingProviderName } from './provider.ts';

describe('createEmbeddingProvider', () => {
  const validConfigs: Record<EmbeddingProviderName, Parameters<typeof createEmbeddingProvider>[0]> = {
    'bundled-cpu': { name: 'bundled-cpu' },
    'bundled-gpu': { name: 'bundled-gpu' },
    'bundled-large': { name: 'bundled-large' },
    ollama: { name: 'ollama' },
    'lm-studio': { name: 'lm-studio' },
    vllm: { name: 'vllm', baseUrl: 'http://localhost:8000' },
    openai: { name: 'openai', apiKey: 'sk-test' },
    'openai-compatible': { name: 'openai-compatible', baseUrl: 'https://embed.example.com', model: 'embed' },
    google: { name: 'google', apiKey: 'google-key' },
    disabled: { name: 'disabled' },
  };

  test('maps every provider name to an adapter', () => {
    for (const name of EmbeddingProviderNameSchema.options) {
      const provider = createEmbeddingProvider(validConfigs[name]);
      expect(provider.ok).toBe(true);
      if (provider.ok) expect(provider.data.name).toBe(name);
    }
  });

  test('rejects unknown config keys', () => {
    const provider = createEmbeddingProvider({ name: 'disabled', extra: true } as Parameters<typeof createEmbeddingProvider>[0]);
    expect(provider.ok).toBe(false);
    if (!provider.ok) expect(provider.error.code).toBe('CONFIG_INVALID');
  });

  test('rejects provider-specific missing config', () => {
    expect(createEmbeddingProvider({ name: 'openai' }).ok).toBe(false);
    expect(createEmbeddingProvider({ name: 'google' }).ok).toBe(false);
    expect(createEmbeddingProvider({ name: 'vllm' }).ok).toBe(false);
    expect(createEmbeddingProvider({ name: 'openai-compatible', baseUrl: 'https://example.com' }).ok).toBe(false);
  });
});
