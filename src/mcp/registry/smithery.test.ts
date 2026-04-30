import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { fetchSmitheryRegistry } from './smithery.ts';

const sampleResponse = {
  servers: [
    {
      qualifiedName: '@smithery-ai/server-sequential-thinking',
      displayName: 'Sequential Thinking',
      description: 'Dynamic problem solving through sequential thoughts',
      verified: true,
      transport: 'stdio',
      command: ['npx', '-y', '@smithery-ai/server-sequential-thinking'],
      iconUrl: 'https://example.com/thinking-icon.png',
      useCases: ['reasoning', 'planning'],
      toolNames: ['sequential_thinking'],
      homepage: 'https://github.com/smithery-ai/server-sequential-thinking',
      oneLiner: 'Break down complex problems into sequential steps',
    },
    {
      qualifiedName: '@modelcontextprotocol/server-filesystem',
      displayName: 'Filesystem',
      description: 'Access the local filesystem',
      verified: false,
      transport: 'stdio',
      command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      iconUrl: 'https://example.com/fs-icon.png',
    },
    {
      qualifiedName: '@brave/brave-search',
      displayName: 'Brave Search',
      description: 'Search the web',
      verified: true,
      transport: 'streamable-http',
      url: 'https://brave-search.mcp.example.com',
      useCases: ['search'],
      toolNames: ['brave_web_search', 'brave_local_search'],
    },
  ],
  hasMore: true,
  total: 3000,
};

describe('fetchSmitheryRegistry', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC;
    } else {
      process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC = originalEnv;
    }
  });

  it('normalises Smithery response to RegistryEntry[]', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(sampleResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )) as unknown as typeof globalThis.fetch;

    const result = await fetchSmitheryRegistry();
    expect(result.entries.length).toBe(3);
    expect(result.hasMore).toBe(true);

    const first = result.entries[0];
    expect(first?.source).toBe('smithery');
    expect(first?.name).toBe('@smithery-ai/server-sequential-thinking');
    expect(first?.displayName).toBe('Sequential Thinking');
    expect(first?.transport).toBe('stdio');

    const second = result.entries[1];
    expect(second?.name).toBe('@brave/brave-search');
    expect(second?.transport).toBe('streamable-http');
    expect(second?.url).toBe('https://brave-search.mcp.example.com');
    expect(second?.useCases).toEqual(['search']);

    const third = result.entries[2];
    expect(third?.name).toBe('@modelcontextprotocol/server-filesystem');
  });

  it('sorts verified entries first', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(sampleResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )) as unknown as typeof globalThis.fetch;

    const result = await fetchSmitheryRegistry();

    // Verified entries first: Sequential Thinking (verified), Brave Search (verified), Filesystem (not verified)
    const firstTwoNames = result.entries.slice(0, 2).map((e) => e.name);
    // Both are verified, exact order among verified doesn't matter
    expect(firstTwoNames).toContain('@smithery-ai/server-sequential-thinking');
    expect(firstTwoNames).toContain('@brave/brave-search');

    const lastEntry = result.entries[2];
    expect(lastEntry?.name).toBe('@modelcontextprotocol/server-filesystem');
  });

  it('passes pagination and query params to the API', async () => {
    let requestedUrl = '';
    globalThis.fetch = ((input: unknown) => {
      requestedUrl = typeof input === 'string' ? input : (input as URL).toString();
      return Promise.resolve(
        new Response(JSON.stringify(sampleResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as unknown as typeof globalThis.fetch;

    await fetchSmitheryRegistry({ page: 3, pageSize: 20, query: 'search' });
    expect(requestedUrl).toContain('page=3');
    expect(requestedUrl).toContain('pageSize=20');
    expect(requestedUrl).toContain('q=search');
  });

  it('returns empty when ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC is set', async () => {
    process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC = '1';

    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof globalThis.fetch;

    const result = await fetchSmitheryRegistry();
    expect(result.entries).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(fetchCalled).toBe(false);
  });

  it('retries on 429 with exponential backoff', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount += 1;
      return Promise.resolve(
        new Response('Rate limited', {
          status: 429,
          headers: { 'Retry-After': '0' },
        }),
      );
    }) as unknown as typeof globalThis.fetch;

    const result = await fetchSmitheryRegistry();
    // Should retry MAX_RETRIES times, then give up with empty result
    expect(callCount).toBe(4); // initial + 3 retries
    expect(result.entries).toEqual([]);
  }, { timeout: 15_000 });

  it('retries on network errors', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount += 1;
      return Promise.reject(new Error('ECONNREFUSED'));
    }) as unknown as typeof globalThis.fetch;

    const result = await fetchSmitheryRegistry();
    // Should retry MAX_RETRIES times, then return empty
    expect(callCount).toBe(4); // initial + 3 retries
    expect(result.entries).toEqual([]);
  }, { timeout: 15_000 });

  it('succeeds on first retry after 429', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          new Response('Rate limited', {
            status: 429,
            headers: { 'Retry-After': '0' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(sampleResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as unknown as typeof globalThis.fetch;

    const result = await fetchSmitheryRegistry();
    expect(callCount).toBe(2);
    expect(result.entries.length).toBe(3);
  });

  it('handles malformed response gracefully', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ notServers: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )) as unknown as typeof globalThis.fetch;

    const result = await fetchSmitheryRegistry();
    expect(result.entries).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});
