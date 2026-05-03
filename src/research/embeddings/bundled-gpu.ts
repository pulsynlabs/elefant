import { BundledEmbeddingProvider, __setPipelineFactoryForTests } from './_bundled.ts';
import type { EmbeddingProviderConfig } from './provider.ts';

export { __setPipelineFactoryForTests };

export function createBundledGpuProvider(config: EmbeddingProviderConfig): BundledEmbeddingProvider {
  return new BundledEmbeddingProvider(config, {
    name: 'bundled-gpu',
    defaultModelId: 'Xenova/all-MiniLM-L6-v2',
    defaultDim: 384,
    preferWebGpu: true,
  });
}
