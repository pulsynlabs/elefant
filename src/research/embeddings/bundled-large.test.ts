import { afterEach, describe, expect, test } from 'bun:test';
import { __setPipelineFactoryForTests, createBundledLargeProvider } from './bundled-large.ts';

afterEach(() => __setPipelineFactoryForTests(null));

describe('bundled-large embedding provider', () => {
  test('uses bge-base default with 768 dimensions', async () => {
    __setPipelineFactoryForTests(async (_task, modelId) => {
      expect(modelId).toBe('Xenova/bge-base-en-v1.5');
      return async () => ({ data: Float32Array.from([1, 2, 3]) });
    });
    const provider = createBundledLargeProvider({ name: 'bundled-large' });
    expect((await provider.init()).ok).toBe(true);
    expect(provider.backend()).toBe('webgpu');
    expect(provider.dim()).toBe(768);
  });
});
