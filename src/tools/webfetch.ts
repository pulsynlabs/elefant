/**
 * Webfetch tool — fetch web content and return cleaned text or markdown.
 * Sanitizes HTML to mitigate prompt injection attacks.
 */

import type { ToolDefinition } from '../types/tools.js';
import type { ElefantError } from '../types/errors.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';

export interface WebfetchParams {
  url: string;
  format?: 'text' | 'markdown';
  conversationId?: string;
}

const MAX_OUTPUT_LENGTH = 50000;
const VERSION = '0.1.0';

/**
 * Validate URL scheme — only http: and https: are allowed.
 */
function validateUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Sanitize HTML content by stripping dangerous/injected content:
 * - <script>...</script> blocks
 * - <style>...</style> blocks
 * - HTML comments <!-- ... -->
 */
function sanitizeHtml(html: string): string {
  // Strip script blocks (multiline, case-insensitive)
  let cleaned = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Strip style blocks (multiline, case-insensitive)
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Strip HTML comments (multiline)
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  return cleaned;
}

/**
 * Convert HTML to markdown-like text:
 * - Strip remaining HTML tags
 * - Collapse runs of whitespace/blank lines to single blank lines
 */
function htmlToMarkdown(html: string): string {
  // Strip all remaining HTML tags
  let text = html.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse runs of whitespace to single spaces
  text = text.replace(/[ \t]+/g, ' ');

  // Collapse runs of blank lines to single blank lines
  text = text.replace(/\n\s*\n+/g, '\n\n');

  // Trim leading/trailing whitespace
  text = text.trim();

  return text;
}

/**
 * Convert HTML to plain text:
 * - Strip all HTML tags
 * - Collapse all whitespace
 */
function htmlToText(html: string): string {
  // Strip all HTML tags
  let text = html.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Replace all whitespace runs with single spaces
  text = text.replace(/\s+/g, ' ');

  // Trim
  text = text.trim();

  return text;
}

/**
 * Webfetch tool definition.
 */
export const webfetchTool: ToolDefinition<WebfetchParams, string> = {
  name: 'webfetch',
  description:
    'Fetch web content from a URL and return it as cleaned text or markdown. ' +
    'Sanitizes content by stripping scripts, styles, and HTML comments to prevent prompt injection.',
  parameters: {
    url: {
      type: 'string',
      description: 'The URL to fetch (http: or https: only)',
      required: true,
    },
    format: {
      type: 'string',
      description: 'Output format: "markdown" (default) or "text"',
      required: false,
      default: 'markdown',
    },
    conversationId: {
      type: 'string',
      description: 'Optional conversation ID for temp file naming',
      required: false,
      default: 'default',
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    const { url, format = 'markdown', conversationId = 'default' } = params;

    // Validate URL scheme
    const parsedUrl = validateUrl(url);
    if (!parsedUrl) {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'Only http/https URLs are supported',
      });
    }

    try {
      // Fetch with User-Agent header
      const response = await fetch(url, {
        headers: {
          'User-Agent': `Elefant/${VERSION}`,
        },
      });

      // Check for non-2xx status
      if (!response.ok) {
        return err({
          code: 'TOOL_EXECUTION_FAILED',
          message: `Fetch failed: HTTP ${response.status}`,
        });
      }

      // Get response text
      const html = await response.text();

      // Sanitize HTML (strip scripts, styles, comments)
      const sanitized = sanitizeHtml(html);

      // Convert to requested format
      let output: string;
      if (format === 'text') {
        output = htmlToText(sanitized);
      } else {
        output = htmlToMarkdown(sanitized);
      }

      // Handle truncation if over limit
      if (output.length > MAX_OUTPUT_LENGTH) {
        const timestamp = Date.now();
        const tempPath = `/tmp/elefant-webfetch-${conversationId}-${timestamp}.txt`;

        // Write full content to temp file
        await Bun.write(tempPath, output);

        // Return truncated content with notice
        const truncated = output.slice(0, MAX_OUTPUT_LENGTH);
        const notice = `\n\n[Output truncated at ${MAX_OUTPUT_LENGTH} chars. Full content available at: ${tempPath}]`;

        return ok(truncated + notice);
      }

      return ok(output);
    } catch (error) {
      // Never throw — return error result
      const message = error instanceof Error ? error.message : String(error);
      return err({
        code: 'TOOL_EXECUTION_FAILED',
        message: `Failed to fetch: ${message}`,
      });
    }
  },
};
