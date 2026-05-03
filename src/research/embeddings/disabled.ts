import type { Result } from '../../types/result.ts';
import { ok } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import type { EmbedResult, EmbeddingProvider } from './provider.ts';

export function createDisabledProvider(): EmbeddingProvider {
  return {
    name: 'disabled',
    isLocal: true,
    async init(): Promise<Result<void, ElefantError>> { return ok(undefined); },
    dim(): number { return 0; },
    async embed(): Promise<Result<EmbedResult, ElefantError>> { return ok({ vectors: [], dim: 0 }); },
    async dispose(): Promise<void> {},
  };
}
