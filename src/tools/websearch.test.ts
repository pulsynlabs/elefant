/**
 * Websearch tool tests — mocked fetch, no real network calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { websearchTool } from './websearch.js';

// Store original fetch and env
let originalFetch: typeof globalThis.fetch;
let originalEnv: string | undefined;

describe('websearchTool', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = process.env.BRAVE_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch as unknown as typeof globalThis.fetch;
    if (originalEnv === undefined) {
      delete process.env.BRAVE_API_KEY;
    } else {
      process.env.BRAVE_API_KEY = originalEnv;
    }
  });

  it('returns ok with disabled message when BRAVE_API_KEY is missing', async () => {
    delete process.env.BRAVE_API_KEY;

    const result = await websearchTool.execute({ query: 'test' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(
        'Web search is disabled. Set the BRAVE_API_KEY environment variable to enable this tool.'
      );
    }
  });

  it('returns ok with disabled message when BRAVE_API_KEY is empty string', async () => {
    process.env.BRAVE_API_KEY = '';

    const result = await websearchTool.execute({ query: 'test' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(
        'Web search is disabled. Set the BRAVE_API_KEY environment variable to enable this tool.'
      );
    }
  });

  it('returns ok with disabled message when BRAVE_API_KEY is whitespace only', async () => {
    process.env.BRAVE_API_KEY = '   ';

    const result = await websearchTool.execute({ query: 'test' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(
        'Web search is disabled. Set the BRAVE_API_KEY environment variable to enable this tool.'
      );
    }
  });

  it('returns formatted results on successful search', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';

    const mockResults = [
      {
        title: 'First Result',
        url: 'https://example.com/first',
        description: 'This is the first search result.',
      },
      {
        title: 'Second Result',
        url: 'https://example.com/second',
        description: 'This is the second search result.',
      },
    ];

    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: mockResults,
          },
        }),
      }) as Response) as unknown as typeof globalThis.fetch;

    const result = await websearchTool.execute({ query: 'test query', count: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Title: First Result');
      expect(result.data).toContain('URL: https://example.com/first');
      expect(result.data).toContain('This is the first search result.');
      expect(result.data).toContain('Title: Second Result');
      expect(result.data).toContain('URL: https://example.com/second');
      expect(result.data).toContain('---');
    }
  });

  it('returns no results message when web.results is empty', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';

    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [],
          },
        }),
      }) as Response) as unknown as typeof globalThis.fetch;

    const result = await websearchTool.execute({ query: 'test query' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('No results found.');
    }
  });

  it('returns no results message when web is undefined', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';

    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Response) as unknown as typeof globalThis.fetch;

    const result = await websearchTool.execute({ query: 'test query' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('No results found.');
    }
  });

  it('returns PROVIDER_ERROR on non-2xx response', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';

    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 429,
        json: async () => ({}),
      }) as Response) as unknown as typeof globalThis.fetch;

    const result = await websearchTool.execute({ query: 'test query' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_ERROR');
      expect(result.error.message).toBe('Brave Search failed: HTTP 429');
    }
  });

  it('returns PROVIDER_ERROR on 401 response', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';

    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        json: async () => ({}),
      }) as Response) as unknown as typeof globalThis.fetch;

    const result = await websearchTool.execute({ query: 'test query' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_ERROR');
      expect(result.error.message).toBe('Brave Search failed: HTTP 401');
    }
  });

  it('returns PROVIDER_ERROR on network error', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';

    globalThis.fetch = (async () => {
      throw new Error('Network error: Connection refused');
    }) as unknown as typeof globalThis.fetch;

    const result = await websearchTool.execute({ query: 'test query' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_ERROR');
      expect(result.error.message).toBe('Search failed: Network error: Connection refused');
    }
  });

  it('clamps count to minimum of 1 when count is 0', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';
    let capturedUrl: string | undefined;

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [],
          },
        }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    await websearchTool.execute({ query: 'test', count: 0 });

    expect(capturedUrl).toContain('count=1');
  });

  it('clamps count to minimum of 1 when count is negative', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';
    let capturedUrl: string | undefined;

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [],
          },
        }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    await websearchTool.execute({ query: 'test', count: -5 });

    expect(capturedUrl).toContain('count=1');
  });

  it('clamps count to maximum of 20 when count is too high', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';
    let capturedUrl: string | undefined;

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [],
          },
        }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    await websearchTool.execute({ query: 'test', count: 100 });

    expect(capturedUrl).toContain('count=20');
  });

  it('uses default count of 10 when count is not provided', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';
    let capturedUrl: string | undefined;

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [],
          },
        }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    await websearchTool.execute({ query: 'test' });

    expect(capturedUrl).toContain('count=10');
  });

  it('uses provided count when within valid range', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';
    let capturedUrl: string | undefined;

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [],
          },
        }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    await websearchTool.execute({ query: 'test', count: 5 });

    expect(capturedUrl).toContain('count=5');
  });

  it('properly encodes query with special characters', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';
    let capturedUrl: string | undefined;

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [],
          },
        }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    await websearchTool.execute({ query: 'hello world & more!' });

    expect(capturedUrl).toContain('q=hello%20world%20%26%20more!');
  });

  it('includes correct headers in the request', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [],
          },
        }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    await websearchTool.execute({ query: 'test' });

    expect(capturedHeaders['Accept']).toBe('application/json');
    expect(capturedHeaders['X-Subscription-Token']).toBe('test-api-key');
  });

  it('handles non-Error throws gracefully', async () => {
    process.env.BRAVE_API_KEY = 'test-api-key';

    globalThis.fetch = (async () => {
      throw 'Some string error';
    }) as unknown as typeof globalThis.fetch;

    const result = await websearchTool.execute({ query: 'test query' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_ERROR');
      expect(result.error.message).toBe('Search failed: Some string error');
    }
  });
});
