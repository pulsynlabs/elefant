/**
 * Websearch tool — search the web using Brave Search API.
 * Gracefully degrades when BRAVE_API_KEY is not set.
 */

import type { ToolDefinition } from '../types/tools.js';
import type { ElefantError } from '../types/errors.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';

export interface WebsearchParams {
  query: string;
  count?: number;
}

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
}

/**
 * Format a single search result for LLM consumption.
 */
function formatResult(result: BraveSearchResult): string {
  return `Title: ${result.title}\nURL: ${result.url}\n${result.description}`;
}

/**
 * Websearch tool definition.
 */
export const websearchTool: ToolDefinition<WebsearchParams, string> = {
  name: 'websearch',
  description: 'Search the web using Brave Search. Requires BRAVE_API_KEY environment variable.',
  parameters: {
    query: {
      type: 'string',
      description: 'Search query',
      required: true,
    },
    count: {
      type: 'number',
      description: 'Number of results (1-20, default 10)',
      required: false,
      default: 10,
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    const { query, count = 10 } = params;

    // Check for API key - graceful degradation
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      return ok(
        'Web search is disabled. Set the BRAVE_API_KEY environment variable to enable this tool.'
      );
    }

    // Clamp count to [1, 20]
    const clampedCount = Math.min(Math.max(count, 1), 20);

    try {
      // Build the API URL
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${clampedCount}`;

      // Make the request
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      });

      // Handle non-2xx responses
      if (!response.ok) {
        return err({
          code: 'PROVIDER_ERROR',
          message: `Brave Search failed: HTTP ${response.status}`,
        });
      }

      // Parse the response
      const data = (await response.json()) as BraveSearchResponse;

      // Extract and format results
      const results = data.web?.results ?? [];

      if (results.length === 0) {
        return ok('No results found.');
      }

      const formattedResults = results.map(formatResult).join('\n---\n');

      return ok(formattedResults);
    } catch (error) {
      // Handle network errors
      const message = error instanceof Error ? error.message : String(error);
      return err({
        code: 'PROVIDER_ERROR',
        message: `Search failed: ${message}`,
      });
    }
  },
};
