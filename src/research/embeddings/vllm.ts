import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { err } from '../../types/result.ts';
import { configError } from './_http.ts';
import { createOpenAiLikeProvider } from './openai-compatible.ts';
import type { EmbeddingProvider, EmbeddingProviderConfig } from './provider.ts';

export function createVllmProvider(config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> {
  if (!config.baseUrl) return err(configError('vllm embedding provider requires baseUrl'));
  return createOpenAiLikeProvider({ ...config, name: 'vllm' }, {
    name: 'vllm',
    url: `${config.baseUrl.replace(/\/+$/, '')}/v1/embeddings`,
    retry: '5xx',
    defaultModel: config.model ?? 'text-embedding-model',
    requireModel: false,
    apiKeyRequired: false,
  });
}
