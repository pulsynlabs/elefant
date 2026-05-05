export type { EmbedResult, EmbeddingProvider, EmbeddingProviderConfig, EmbeddingProviderName } from './provider.ts';
export { EmbeddingProviderConfigSchema, EmbeddingProviderNameSchema, createEmbeddingProvider } from './provider.ts';
export { createBundledCpuProvider } from './bundled-cpu.ts';
export { createBundledGpuProvider } from './bundled-gpu.ts';
export { createBundledLargeProvider } from './bundled-large.ts';
export { createOllamaProvider } from './ollama.ts';
export { createLmStudioProvider } from './lm-studio.ts';
export { createVllmProvider } from './vllm.ts';
export { createOpenAiProvider } from './openai.ts';
export { createOpenAiCompatibleProvider } from './openai-compatible.ts';
export { createGoogleProvider } from './google.ts';
export { createDisabledProvider } from './disabled.ts';

export const EMBEDDING_PROVIDER_REGISTRY = {
  'bundled-cpu': 'Bundled CPU (MiniLM)',
  'bundled-gpu': 'Bundled GPU (MiniLM with WebGPU fallback)',
  'bundled-large': 'Bundled Large (BGE base)',
  ollama: 'Ollama local server',
  'lm-studio': 'LM Studio local server',
  vllm: 'vLLM OpenAI-compatible server',
  openai: 'OpenAI embeddings API',
  'openai-compatible': 'Generic OpenAI-compatible embeddings API',
  google: 'Google Gemini embeddings API',
  disabled: 'Disabled vector embeddings',
} as const;
