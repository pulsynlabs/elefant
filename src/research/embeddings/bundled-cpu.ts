import { BundledEmbeddingProvider, __setPipelineFactoryForTests } from './_bundled.ts';
import type { EmbeddingProviderConfig } from './provider.ts';

export { __setPipelineFactoryForTests };

export function createBundledCpuProvider(config: EmbeddingProviderConfig): BundledEmbeddingProvider {
  return new BundledEmbeddingProvider(config, {
    name: 'bundled-cpu',
    defaultModelId: 'Xenova/all-MiniLM-L6-v2',
    defaultDim: 384,
    preferWebGpu: false,
  });
}
