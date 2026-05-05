import { afterEach, describe, expect, test } from 'bun:test';
import { __setPipelineFactoryForTests, createBundledGpuProvider } from './bundled-gpu.ts';

afterEach(() => __setPipelineFactoryForTests(null));

describe('bundled-gpu embedding provider', () => {
  test('prefers webgpu and exposes the backend', async () => {
    __setPipelineFactoryForTests(async () => async () => ({ data: Float32Array.from([1, 2]) }));
    const provider = createBundledGpuProvider({ name: 'bundled-gpu' });
    expect((await provider.init()).ok).toBe(true);
    expect(provider.backend()).toBe('webgpu');
    expect(provider.dim()).toBe(384);
  });
});
