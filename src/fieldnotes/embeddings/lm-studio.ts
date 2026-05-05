import { z } from 'zod';
import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { ok } from '../../types/result.ts';
import { joinUrl, parseJson, postJson, providerError, toFloat32Vector } from './_http.ts';
import type { EmbedResult, EmbeddingProvider, EmbeddingProviderConfig } from './provider.ts';

const EmbeddingDataSchema = z.object({ embedding: z.array(z.number()) }).strict();
const OpenAiEmbeddingResponseSchema = z.object({ data: z.array(EmbeddingDataSchema) }).strict();

export function createLmStudioProvider(config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> {
  const baseUrl = config.baseUrl ?? 'http://localhost:1234';
  const model = config.model ?? 'text-embedding-nomic-embed-text-v1.5';
  let detectedDim: number | null = null;

  return ok({
    name: 'lm-studio',
    isLocal: false,
    async init(): Promise<Result<void, ElefantError>> { return ok(undefined); },
    dim(): number {
      if (detectedDim === null) throw new Error('Embedding provider dim() called before successful embed');
      return detectedDim;
    },
    async embed(texts: string[]): Promise<Result<EmbedResult, ElefantError>> {
      const response = await postJson({ url: joinUrl(baseUrl, '/v1/embeddings'), body: { model, input: texts }, retry: '5xx' });
      if (!response.ok) return response;
      const parsed = parseJson(OpenAiEmbeddingResponseSchema, response.data, 'lm-studio');
      if (!parsed.ok) return parsed;
      if (parsed.data.data.length !== texts.length) return { ok: false, error: providerError('LM Studio returned the wrong number of embeddings') };
      const vectors = parsed.data.data.map((item) => toFloat32Vector(item.embedding));
      detectedDim = vectors[0]?.length ?? 0;
      return ok({ vectors, dim: detectedDim });
    },
    async dispose(): Promise<void> { detectedDim = null; },
  });
}
