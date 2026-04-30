import type { RegistryEntry } from './types.ts';

const SMITHERY_BASE_URL = 'https://registry.smithery.ai/servers';
const MAX_RETRIES = 3;

interface SmitheryServer {
  qualifiedName: string;
  displayName?: string;
  description?: string;
  verified?: boolean;
  transport?: string;
  command?: string[];
  url?: string;
  iconUrl?: string;
  useCases?: string[];
  toolNames?: string[];
  homepage?: string;
  oneLiner?: string;
}

interface SmitheryResponse {
  servers: SmitheryServer[];
  hasMore?: boolean;
  total?: number;
}

function normalizeTransport(raw?: string): RegistryEntry['transport'] {
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

function normalizeSmitheryEntry(raw: SmitheryServer): RegistryEntry {
  return {
    id: raw.qualifiedName,
    source: 'smithery' as const,
    name: raw.qualifiedName,
    displayName: raw.displayName ?? raw.qualifiedName,
    description: raw.description ?? '',
    transport: normalizeTransport(raw.transport),
    command: raw.command,
    url: raw.url,
    iconUrl: raw.iconUrl,
    useCases: raw.useCases,
    toolNames: raw.toolNames,
    homepage: raw.homepage,
    oneLiner: raw.oneLiner ?? raw.description,
  };
}

function sortVerifiedFirst(entries: RegistryEntry[], rawServers: SmitheryServer[]): RegistryEntry[] {
  const verifiedMap = new Map<string, boolean>();
  for (const server of rawServers) {
    verifiedMap.set(server.qualifiedName, server.verified === true);
  }

  return [...entries].sort((a, b) => {
    const aVerified = verifiedMap.get(a.name) ?? false;
    const bVerified = verifiedMap.get(b.name) ?? false;
    if (aVerified && !bVerified) return -1;
    if (!aVerified && bVerified) return 1;
    return 0;
  });
}

export interface FetchSmitheryOptions {
  page?: number;
  pageSize?: number;
  query?: string;
}

export interface FetchSmitheryResult {
  entries: RegistryEntry[];
  hasMore: boolean;
}

export async function fetchSmitheryRegistry(
  opts: FetchSmitheryOptions = {},
): Promise<FetchSmitheryResult> {
  if (process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC === '1') {
    return { entries: [], hasMore: false };
  }

  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (opts.query) {
    params.set('q', opts.query);
  }

  const url = `${SMITHERY_BASE_URL}?${params.toString()}`;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? Number(retryAfter) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 30_000);

        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        console.warn(
          `[elefant] Smithery registry returned 429 after ${MAX_RETRIES + 1} attempts`,
        );
        return { entries: [], hasMore: false };
      }

      if (!response.ok) {
        console.warn(
          `[elefant] Smithery registry fetch returned ${response.status}: ${response.statusText}`,
        );
        return { entries: [], hasMore: false };
      }

      const json = (await response.json()) as SmitheryResponse;
      if (!json || !Array.isArray(json.servers)) {
        console.warn('[elefant] Unexpected Smithery registry response shape');
        return { entries: [], hasMore: false };
      }

      const entries = sortVerifiedFirst(
        json.servers.map(normalizeSmitheryEntry),
        json.servers,
      );

      return {
        entries,
        hasMore: json.hasMore ?? false,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < MAX_RETRIES) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }
  }

  console.warn(
    `[elefant] Failed to fetch Smithery registry: ${lastError?.message ?? 'unknown error'}`,
  );
  return { entries: [], hasMore: false };
}
