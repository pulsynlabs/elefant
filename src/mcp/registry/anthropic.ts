import type { RegistryEntry } from './types.ts';

const ANTHROPIC_REGISTRY_URL =
  'https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface AnthropicRegistryServer {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  transport: string;
  command?: string[];
  url?: string;
  icon_url?: string;
  use_cases?: string[];
  tool_names?: string[];
  homepage?: string;
  one_liner?: string;
}

interface AnthropicRegistryResponse {
  servers: AnthropicRegistryServer[];
}

let cache: { data: RegistryEntry[]; fetchedAt: number } | null = null;

function normalizeTransport(raw: string): RegistryEntry['transport'] {
  switch (raw) {
    case 'stdio':
      return 'stdio';
    case 'sse':
      return 'sse';
    case 'streamable-http':
    case 'streamable_http':
    case 'streamableHttp':
      return 'streamable-http';
    default:
      return 'streamable-http';
  }
}

function normalizeEntry(entry: AnthropicRegistryServer): RegistryEntry {
  return {
    id: entry.id,
    source: 'anthropic' as const,
    name: entry.name,
    displayName: entry.display_name ?? entry.name,
    description: entry.description ?? '',
    transport: normalizeTransport(entry.transport),
    command: entry.command,
    url: entry.url,
    iconUrl: entry.icon_url,
    useCases: entry.use_cases,
    toolNames: entry.tool_names,
    homepage: entry.homepage,
    oneLiner: entry.one_liner,
  };
}

export async function fetchAnthropicRegistry(): Promise<RegistryEntry[]> {
  if (process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC === '1') {
    return [];
  }

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const response = await fetch(ANTHROPIC_REGISTRY_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.warn(
        `[elefant] Anthropic registry fetch returned ${response.status}: ${response.statusText}`,
      );
      return cache?.data ?? [];
    }

    const json = (await response.json()) as AnthropicRegistryResponse;

    if (!json || !Array.isArray(json.servers)) {
      console.warn('[elefant] Unexpected Anthropic registry response shape');
      return cache?.data ?? [];
    }

    const entries = json.servers.map(normalizeEntry);

    cache = { data: entries, fetchedAt: Date.now() };
    return entries;
  } catch (error) {
    console.warn(
      `[elefant] Failed to fetch Anthropic registry: ${error instanceof Error ? error.message : String(error)}`,
    );
    return cache?.data ?? [];
  }
}

export function prefetchAnthropicRegistry(): void {
  void fetchAnthropicRegistry();
}

export function invalidateAnthropicCache(): void {
  cache = null;
}
