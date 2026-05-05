import { z } from 'zod';
import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { err, ok } from '../../types/result.ts';
import { configError, parseJson, postJson, providerError, toFloat32Vector } from './_http.ts';
import type { EmbedResult, EmbeddingProvider, EmbeddingProviderConfig } from './provider.ts';

const GoogleEmbeddingResponseSchema = z.object({
  embeddings: z.array(z.object({ values: z.array(z.number()) }).strict()),
}).strict();

export function createGoogleProvider(config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> {
  if (!config.apiKey) return err(configError('google embedding provider requires apiKey'));
  const model = config.model ?? 'text-embedding-004';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents?key=${encodeURIComponent(config.apiKey)}`;
  let detectedDim: number | null = model === 'text-embedding-004' ? 768 : null;

  return ok({
    name: 'google',
    isLocal: false,
    async init(): Promise<Result<void, ElefantError>> { return ok(undefined); },
    dim(): number {
      if (detectedDim === null) throw new Error('Embedding provider dim() called before successful embed');
      return detectedDim;
    },
    async embed(texts: string[]): Promise<Result<EmbedResult, ElefantError>> {
      const body = { requests: texts.map((text) => ({ model, content: { parts: [{ text }] } })) };
      const response = await postJson({ url, body });
      if (!response.ok) return response;
      const parsed = parseJson(GoogleEmbeddingResponseSchema, response.data, 'google');
      if (!parsed.ok) return parsed;
      if (parsed.data.embeddings.length !== texts.length) return err(providerError('Google returned the wrong number of embeddings'));
      const vectors = parsed.data.embeddings.map((item) => toFloat32Vector(item.values));
      detectedDim = vectors[0]?.length ?? 0;
      return ok({ vectors, dim: detectedDim });
    },
    async dispose(): Promise<void> { detectedDim = null; },
  });
}
