import { z } from 'zod';
import type { ElefantError } from '../../types/errors.ts';
import type { Result } from '../../types/result.ts';
import { err, ok } from '../../types/result.ts';

export interface JsonPostOptions {
  readonly url: string;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
  readonly retry?: '5xx' | 'rate-limit';
  readonly backoffMs?: number;
}

export function providerError(message: string, details?: unknown): ElefantError {
  return { code: 'PROVIDER_ERROR', message, details };
}

export function configError(message: string, details?: unknown): ElefantError {
  return { code: 'CONFIG_INVALID', message, details };
}

export function validationError(message: string, details?: unknown): ElefantError {
  return { code: 'VALIDATION_ERROR', message, details };
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryDelay(response: Response, fallbackMs: number): Promise<number> {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return fallbackMs;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return fallbackMs;
}

export async function postJson(options: JsonPostOptions): Promise<Result<unknown, ElefantError>> {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const maxAttempts = options.retry ? 2 : 1;
  const backoffMs = options.backoffMs ?? 250;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(options.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(options.body),
      });
    } catch (error) {
      return err(providerError('Embedding request failed', error));
    }

    const shouldRetry5xx = options.retry === '5xx' && response.status >= 500 && attempt < maxAttempts;
    const shouldRetry429 = options.retry === 'rate-limit' && response.status === 429 && attempt < maxAttempts;
    if (shouldRetry5xx || shouldRetry429) {
      await sleep(shouldRetry429 ? await retryDelay(response, backoffMs) : backoffMs);
      continue;
    }

    if (!response.ok) {
      return err(providerError(`Embedding request failed with HTTP ${response.status}`, { status: response.status }));
    }

    try {
      return ok(await response.json());
    } catch (error) {
      return err(providerError('Embedding response was not valid JSON', error));
    }
  }

  return err(providerError('Embedding request retry loop exhausted'));
}

export function parseJson<T>(schema: z.ZodType<T>, value: unknown, provider: string): Result<T, ElefantError> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return err(validationError(`${provider} returned a malformed embedding response`, parsed.error.issues));
  }
  return ok(parsed.data);
}

export function toFloat32Vector(values: readonly number[]): Float32Array {
  return Float32Array.from(values);
}
