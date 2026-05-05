import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { createOpenAiLikeProvider } from './openai-compatible.ts';
import type { EmbeddingProvider, EmbeddingProviderConfig } from './provider.ts';

export function createOpenAiProvider(config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> {
  return createOpenAiLikeProvider(config, {
    name: 'openai',
    url: 'https://api.openai.com/v1/embeddings',
    retry: 'rate-limit',
    defaultModel: 'text-embedding-3-small',
    requireModel: false,
    apiKeyRequired: true,
  });
}
