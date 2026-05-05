import { z } from 'zod';
import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { err, ok } from '../../types/result.ts';
import { configError, postJson, providerError, parseJson, toFloat32Vector } from './_http.ts';
import type { EmbedResult, EmbeddingProvider, EmbeddingProviderConfig, EmbeddingProviderName } from './provider.ts';

const EmbeddingDataSchema = z.object({ embedding: z.array(z.number()) }).strict();
const EmbeddingResponseSchema = z.object({ data: z.array(EmbeddingDataSchema) }).strict();

export interface OpenAiLikeOptions {
  readonly name: Extract<EmbeddingProviderName, 'openai' | 'openai-compatible' | 'vllm'>;
  readonly url: string;
  readonly retry: '5xx' | 'rate-limit';
  readonly defaultModel?: string;
  readonly requireModel: boolean;
  readonly apiKeyRequired: boolean;
}

export function createOpenAiLikeProvider(config: EmbeddingProviderConfig, options: OpenAiLikeOptions): Result<EmbeddingProvider, ElefantError> {
  if (options.apiKeyRequired && !config.apiKey) return err(configError(`${options.name} embedding provider requires apiKey`));
  const model = config.model ?? options.defaultModel;
  if (options.requireModel && !model) return err(configError(`${options.name} embedding provider requires model`));
  if (!model) return err(configError(`${options.name} embedding provider has no model configured`));
  let detectedDim: number | null = options.name === 'openai' && model === 'text-embedding-3-small' ? 1536 : null;

  return ok({
    name: options.name,
    isLocal: false,
    async init(): Promise<Result<void, ElefantError>> { return ok(undefined); },
    dim(): number {
      if (detectedDim === null) throw new Error('Embedding provider dim() called before successful embed');
      return detectedDim;
    },
    async embed(texts: string[]): Promise<Result<EmbedResult, ElefantError>> {
      const headers = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined;
      const response = await postJson({ url: options.url, body: { model, input: texts }, headers, retry: options.retry });
      if (!response.ok) return response;
      const parsed = parseJson(EmbeddingResponseSchema, response.data, options.name);
      if (!parsed.ok) return parsed;
      if (parsed.data.data.length !== texts.length) return err(providerError(`${options.name} returned the wrong number of embeddings`));
      const vectors = parsed.data.data.map((item) => toFloat32Vector(item.embedding));
      detectedDim = vectors[0]?.length ?? 0;
      return ok({ vectors, dim: detectedDim });
    },
    async dispose(): Promise<void> { detectedDim = null; },
  });
}

export function createOpenAiCompatibleProvider(config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> {
  if (!config.baseUrl) return err(configError('openai-compatible embedding provider requires baseUrl'));
  return createOpenAiLikeProvider(config, {
    name: 'openai-compatible',
    url: `${config.baseUrl.replace(/\/+$/, '')}/v1/embeddings`,
    retry: 'rate-limit',
    requireModel: true,
    apiKeyRequired: false,
  });
}
