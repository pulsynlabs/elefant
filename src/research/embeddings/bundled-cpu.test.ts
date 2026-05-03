import { afterEach, describe, expect, test } from 'bun:test';
import { __setPipelineFactoryForTests, createBundledCpuProvider } from './bundled-cpu.ts';

afterEach(() => __setPipelineFactoryForTests(null));

describe('bundled-cpu embedding provider', () => {
  test('uses MiniLM defaults and embeds one text at a time', async () => {
    const calls: string[] = [];
    __setPipelineFactoryForTests(async (_task, modelId) => {
      expect(modelId).toBe('Xenova/all-MiniLM-L6-v2');
      return async (text) => {
        calls.push(text);
        return { data: Float32Array.from([1, 2, 3]) };
      };
    });
    const provider = createBundledCpuProvider({ name: 'bundled-cpu' });
    expect((await provider.init()).ok).toBe(true);
    expect(provider.dim()).toBe(384);
    const result = await provider.embed(['a', 'b']);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['a', 'b']);
    if (result.ok) expect(result.data.dim).toBe(384);
  });

  test('detects dim for custom bundled model ids during warmup', async () => {
    __setPipelineFactoryForTests(async () => async () => ({ data: Float32Array.from([1, 2, 3, 4, 5]) }));
    const provider = createBundledCpuProvider({ name: 'bundled-cpu', bundledModelId: 'custom/model' });
    expect((await provider.init()).ok).toBe(true);
    expect(provider.dim()).toBe(5);
  });

  test('returns clean errors for malformed pipeline output', async () => {
    __setPipelineFactoryForTests(async () => async () => ({ data: 'bad' }));
    const provider = createBundledCpuProvider({ name: 'bundled-cpu', bundledModelId: 'custom/model' });
    const result = await provider.init();
    expect(result.ok).toBe(false);
  });
});
