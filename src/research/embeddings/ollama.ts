import { z } from 'zod';
import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { err, ok } from '../../types/result.ts';
import { joinUrl, parseJson, postJson, providerError, toFloat32Vector } from './_http.ts';
import type { EmbedResult, EmbeddingProvider, EmbeddingProviderConfig } from './provider.ts';

const OllamaResponseSchema = z.object({ embedding: z.array(z.number()) }).strict();

async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<Result<R, ElefantError>>): Promise<Result<R[], ElefantError>> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<Result<void, ElefantError>> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const result = await fn(items[index]);
      if (!result.ok) return result;
      results[index] = result.data;
    }
    return ok(undefined);
  }
  const workers = await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  const failed = workers.find((result) => !result.ok);
  if (failed && !failed.ok) return failed;
  return ok(results);
}

export function createOllamaProvider(config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434';
  const model = config.model ?? 'nomic-embed-text';
  let detectedDim: number | null = null;

  async function embedOne(text: string): Promise<Result<Float32Array, ElefantError>> {
    const response = await postJson({ url: joinUrl(baseUrl, '/api/embeddings'), body: { model, prompt: text }, retry: '5xx' });
    if (!response.ok) return response;
    const parsed = parseJson(OllamaResponseSchema, response.data, 'ollama');
    if (!parsed.ok) return parsed;
    detectedDim = parsed.data.embedding.length;
    return ok(toFloat32Vector(parsed.data.embedding));
  }

  return ok({
    name: 'ollama',
    isLocal: false,
    async init(): Promise<Result<void, ElefantError>> { return ok(undefined); },
    dim(): number {
      if (detectedDim === null) throw new Error('Embedding provider dim() called before successful embed');
      return detectedDim;
    },
    async embed(texts: string[]): Promise<Result<EmbedResult, ElefantError>> {
      const vectors = await mapConcurrent(texts, 8, embedOne);
      if (!vectors.ok) return err(vectors.error);
      if (detectedDim === null) return err(providerError('Ollama returned no embeddings'));
      return ok({ vectors: vectors.data, dim: detectedDim });
    },
    async dispose(): Promise<void> { detectedDim = null; },
  });
}
