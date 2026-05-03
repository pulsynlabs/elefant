import { BundledEmbeddingProvider, __setPipelineFactoryForTests } from './_bundled.ts';
import type { EmbeddingProviderConfig } from './provider.ts';

export { __setPipelineFactoryForTests };

export function createBundledLargeProvider(config: EmbeddingProviderConfig): BundledEmbeddingProvider {
  return new BundledEmbeddingProvider(config, {
    name: 'bundled-large',
    defaultModelId: 'Xenova/bge-base-en-v1.5',
    defaultDim: 768,
    preferWebGpu: true,
  });
}
