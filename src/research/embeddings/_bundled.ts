import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { err, ok } from '../../types/result.ts';
import { providerError } from './_http.ts';
import type { EmbedResult, EmbeddingProvider, EmbeddingProviderConfig, EmbeddingProviderName } from './provider.ts';

export type BundledBackend = 'cpu' | 'webgpu';
export type FeatureExtractionPipeline = (text: string, options: { pooling: 'mean'; normalize: true }) => Promise<unknown>;
export type PipelineFactory = (task: 'feature-extraction', modelId: string) => Promise<FeatureExtractionPipeline>;

interface TransformersModule {
  readonly pipeline: PipelineFactory;
  readonly env?: { readonly backends?: { readonly onnx?: { executionProviders?: string[] } } };
}

let pipelineFactoryForTests: PipelineFactory | null = null;

export function __setPipelineFactoryForTests(factory: PipelineFactory | null): void {
  pipelineFactoryForTests = factory;
}

async function defaultPipelineFactory(task: 'feature-extraction', modelId: string): Promise<FeatureExtractionPipeline> {
  const module = (await import('@xenova/transformers')) as TransformersModule;
  return module.pipeline(task, modelId);
}

async function configureWebGpu(): Promise<boolean> {
  if (pipelineFactoryForTests) return true;
  try {
    const module = (await import('@xenova/transformers')) as TransformersModule;
    if (!module.env?.backends?.onnx) return false;
    module.env.backends.onnx.executionProviders = ['webgpu'];
    return true;
  } catch (error) {
    console.warn('research: embeddings WebGPU setup failed; falling back to CPU', error);
    return false;
  }
}

function vectorFromPipelineResult(result: unknown): Result<Float32Array, ElefantError> {
  if (typeof result !== 'object' || result === null || !('data' in result)) {
    return err(providerError('Bundled embedder returned no data'));
  }
  const data = (result as { readonly data: unknown }).data;
  if (data instanceof Float32Array) return ok(data);
  if (Array.isArray(data) && data.every((value) => typeof value === 'number')) return ok(Float32Array.from(data));
  return err(providerError('Bundled embedder returned malformed vector data'));
}

export interface BundledOptions {
  readonly name: EmbeddingProviderName;
  readonly defaultModelId: string;
  readonly defaultDim: number;
  readonly preferWebGpu: boolean;
}

export class BundledEmbeddingProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly isLocal = true;
  private pipe: FeatureExtractionPipeline | null = null;
  private detectedDim: number | null = null;
  private actualBackend: BundledBackend = 'cpu';

  constructor(private readonly config: EmbeddingProviderConfig, private readonly options: BundledOptions) {
    this.name = options.name;
  }

  backend(): BundledBackend {
    return this.actualBackend;
  }

  async init(): Promise<Result<void, ElefantError>> {
    if (this.pipe) return ok(undefined);
    if (this.options.preferWebGpu) {
      this.actualBackend = (await configureWebGpu()) ? 'webgpu' : 'cpu';
    }
    try {
      const factory = pipelineFactoryForTests ?? defaultPipelineFactory;
      this.pipe = await factory('feature-extraction', this.config.bundledModelId ?? this.options.defaultModelId);
    } catch (error) {
      if (this.options.preferWebGpu) {
        console.warn('research: embeddings WebGPU pipeline failed; retrying on CPU', error);
        this.actualBackend = 'cpu';
        try {
          const factory = pipelineFactoryForTests ?? defaultPipelineFactory;
          this.pipe = await factory('feature-extraction', this.config.bundledModelId ?? this.options.defaultModelId);
        } catch (retryError) {
          return err(providerError('Failed to initialize bundled embedding model', retryError));
        }
      } else {
        return err(providerError('Failed to initialize bundled embedding model', error));
      }
    }

    if (this.config.bundledModelId && this.config.bundledModelId !== this.options.defaultModelId) {
      const warmup = await this.embedOne('warmup');
      if (!warmup.ok) return warmup;
      this.detectedDim = warmup.data.length;
    } else {
      this.detectedDim = this.options.defaultDim;
    }
    return ok(undefined);
  }

  dim(): number {
    if (this.detectedDim === null) throw new Error('Embedding provider dim() called before successful init');
    return this.detectedDim;
  }

  async embed(texts: string[]): Promise<Result<EmbedResult, ElefantError>> {
    if (!this.pipe || this.detectedDim === null) return err(providerError('Bundled embedding provider is not initialized'));
    const vectors: Float32Array[] = [];
    for (const text of texts) {
      const vector = await this.embedOne(text);
      if (!vector.ok) return vector;
      vectors.push(vector.data);
    }
    return ok({ vectors, dim: this.detectedDim });
  }

  async dispose(): Promise<void> {
    this.pipe = null;
    this.detectedDim = null;
  }

  private async embedOne(text: string): Promise<Result<Float32Array, ElefantError>> {
    if (!this.pipe) return err(providerError('Bundled embedding provider is not initialized'));
    try {
      return vectorFromPipelineResult(await this.pipe(text, { pooling: 'mean', normalize: true }));
    } catch (error) {
      return err(providerError('Bundled embedding failed', error));
    }
  }
}
