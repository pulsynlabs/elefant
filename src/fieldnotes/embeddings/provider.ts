import { z } from 'zod';
import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { err, ok } from '../../types/result.ts';
import { configError } from './_http.ts';
import { createBundledCpuProvider } from './bundled-cpu.ts';
import { createBundledGpuProvider } from './bundled-gpu.ts';
import { createBundledLargeProvider } from './bundled-large.ts';
import { createDisabledProvider } from './disabled.ts';
import { createGoogleProvider } from './google.ts';
import { createLmStudioProvider } from './lm-studio.ts';
import { createOllamaProvider } from './ollama.ts';
import { createOpenAiProvider } from './openai.ts';
import { createOpenAiCompatibleProvider } from './openai-compatible.ts';
import { createVllmProvider } from './vllm.ts';

export const EmbeddingProviderNameSchema = z.enum([
  'bundled-cpu',
  'bundled-gpu',
  'bundled-large',
  'ollama',
  'lm-studio',
  'vllm',
  'openai',
  'openai-compatible',
  'google',
  'disabled',
]);
export type EmbeddingProviderName = z.infer<typeof EmbeddingProviderNameSchema>;

export const EmbeddingProviderConfigSchema = z.object({
  name: EmbeddingProviderNameSchema,
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  bundledModelId: z.string().optional(),
}).strict();
export type EmbeddingProviderConfig = z.infer<typeof EmbeddingProviderConfigSchema>;

export interface EmbedResult { vectors: Float32Array[]; dim: number; }

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly isLocal: boolean;
  init(): Promise<Result<void, ElefantError>>;
  dim(): number;
  embed(texts: string[]): Promise<Result<EmbedResult, ElefantError>>;
  dispose(): Promise<void>;
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig): Result<EmbeddingProvider, ElefantError> {
  const parsed = EmbeddingProviderConfigSchema.safeParse(config);
  if (!parsed.success) return err(configError('Invalid embedding provider config', parsed.error.issues));

  switch (parsed.data.name) {
    case 'bundled-cpu': return ok(createBundledCpuProvider(parsed.data));
    case 'bundled-gpu': return ok(createBundledGpuProvider(parsed.data));
    case 'bundled-large': return ok(createBundledLargeProvider(parsed.data));
    case 'ollama': return createOllamaProvider(parsed.data);
    case 'lm-studio': return createLmStudioProvider(parsed.data);
    case 'vllm': return createVllmProvider(parsed.data);
    case 'openai': return createOpenAiProvider(parsed.data);
    case 'openai-compatible': return createOpenAiCompatibleProvider(parsed.data);
    case 'google': return createGoogleProvider(parsed.data);
    case 'disabled': return ok(createDisabledProvider());
  }
}
