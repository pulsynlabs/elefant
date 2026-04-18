/**
 * Webfetch tool tests — mocked fetch, no real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { webfetchTool, type WebfetchParams } from './webfetch.js';

describe('webfetchTool', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch and return cleaned markdown content', async () => {
    const mockHtml = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Hello World</h1>
          <p>This is a test paragraph.</p>
        </body>
      </html>
    `;

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Hello World');
      expect(result.data).toContain('This is a test paragraph.');
    }
  });

  it('should strip script blocks from output', async () => {
    const mockHtml = `
      <html>
        <body>
          <p>Safe content</p>
          <script>
            alert('This should be stripped');
            console.log('Malicious code');
          </script>
          <p>More safe content</p>
        </body>
      </html>
    `;

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Safe content');
      expect(result.data).toContain('More safe content');
      expect(result.data).not.toContain('script');
      expect(result.data).not.toContain('alert');
      expect(result.data).not.toContain('Malicious code');
    }
  });

  it('should strip style blocks from output', async () => {
    const mockHtml = `
      <html>
        <head>
          <style>
            body { color: red; }
            .hidden { display: none; }
          </style>
        </head>
        <body>
          <p>Visible content</p>
        </body>
      </html>
    `;

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Visible content');
      expect(result.data).not.toContain('style');
      expect(result.data).not.toContain('color: red');
      expect(result.data).not.toContain('.hidden');
    }
  });

  it('should strip HTML comments from output', async () => {
    const mockHtml = `
      <html>
        <body>
          <!-- This is a comment -->
          <p>Real content</p>
          <!--
            Multi-line comment
            with more text
          -->
          <p>More real content</p>
        </body>
      </html>
    `;

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Real content');
      expect(result.data).toContain('More real content');
      expect(result.data).not.toContain('<!--');
      expect(result.data).not.toContain('-->');
      expect(result.data).not.toContain('This is a comment');
      expect(result.data).not.toContain('Multi-line comment');
    }
  });

  it('should reject ftp:// scheme with VALIDATION_ERROR', async () => {
    const result = await webfetchTool.execute({
      url: 'ftp://example.com/file.txt',
      format: 'markdown',
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string; message: string } }).error.code).toBe('VALIDATION_ERROR');
    expect((result as { ok: false; error: { code: string; message: string } }).error.message).toBe('Only http/https URLs are supported');
  });

  it('should reject file:// scheme with VALIDATION_ERROR', async () => {
    const result = await webfetchTool.execute({
      url: 'file:///etc/passwd',
      format: 'markdown',
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string; message: string } }).error.code).toBe('VALIDATION_ERROR');
    expect((result as { ok: false; error: { code: string; message: string } }).error.message).toBe('Only http/https URLs are supported');
  });

  it('should reject javascript: scheme with VALIDATION_ERROR', async () => {
    const result = await webfetchTool.execute({
      url: "javascript:alert('xss')",
      format: 'markdown',
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string; message: string } }).error.code).toBe('VALIDATION_ERROR');
    expect((result as { ok: false; error: { code: string; message: string } }).error.message).toBe('Only http/https URLs are supported');
  });

  it('should reject invalid URLs with VALIDATION_ERROR', async () => {
    const result = await webfetchTool.execute({
      url: 'not-a-valid-url',
      format: 'markdown',
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string; message: string } }).error.code).toBe('VALIDATION_ERROR');
    expect((result as { ok: false; error: { code: string; message: string } }).error.message).toBe('Only http/https URLs are supported');
  });

  it('should return TOOL_EXECUTION_FAILED on non-2xx HTTP response', async () => {
    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com/not-found',
      format: 'markdown',
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string; message: string } }).error.code).toBe('TOOL_EXECUTION_FAILED');
    expect((result as { ok: false; error: { code: string; message: string } }).error.message).toBe('Fetch failed: HTTP 404');
  });

  it('should return TOOL_EXECUTION_FAILED on 500 error', async () => {
    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com/error',
      format: 'markdown',
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string; message: string } }).error.code).toBe('TOOL_EXECUTION_FAILED');
    expect((result as { ok: false; error: { code: string; message: string } }).error.message).toBe('Fetch failed: HTTP 500');
  });

  it('should truncate output over 50000 chars and write to temp file', async () => {
    // Create HTML that will produce >50000 chars of output
    const longContent = 'A'.repeat(60000);
    const mockHtml = `<html><body><p>${longContent}</p></body></html>`;

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com/long',
      format: 'markdown',
      conversationId: 'test-conv',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should be truncated to 50000 + notice
      expect(result.data.length).toBeGreaterThan(50000);
      expect(result.data.length).toBeLessThan(51000); // Notice adds some chars

      // Should contain truncation notice
      expect(result.data).toContain('[Output truncated at 50000 chars');
      expect(result.data).toContain('/tmp/elefant-webfetch-test-conv-');
      expect(result.data).toContain('.txt]');

      // First 50000 chars should be 'A's
      expect(result.data.slice(0, 50000)).toBe('A'.repeat(50000));
    }
  });

  it('should return TOOL_EXECUTION_FAILED when fetch throws', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Network error: Connection refused');
    }) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string; message: string } }).error.code).toBe('TOOL_EXECUTION_FAILED');
    expect((result as { ok: false; error: { code: string; message: string } }).error.message).toBe('Failed to fetch: Network error: Connection refused');
  });

  it('should return TOOL_EXECUTION_FAILED on timeout or network failure', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string; message: string } }).error.code).toBe('TOOL_EXECUTION_FAILED');
    expect((result as { ok: false; error: { code: string; message: string } }).error.message).toContain('Failed to fetch');
  });

  it('should use text format when specified', async () => {
    const mockHtml = `
      <html>
        <body>
          <h1>Title</h1>
          <p>Paragraph one</p>
          <p>Paragraph two</p>
        </body>
      </html>
    `;

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'text',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Title');
      expect(result.data).toContain('Paragraph one');
      expect(result.data).toContain('Paragraph two');
      // Text format should collapse whitespace more aggressively
      expect(result.data).not.toContain('\n\n'); // No double newlines in text format
    }
  });

  it('should default to markdown format when format not specified', async () => {
    const mockHtml = '<html><body><p>Content</p></body></html>';

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
    } as WebfetchParams);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Content');
    }
  });

  it('should send User-Agent header with Elefant version', async () => {
    const mockHtml = '<html><body><p>Test</p></body></html>';
    let capturedHeaders: Record<string, string> | undefined;

    globalThis.fetch = mock(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(capturedHeaders).toBeDefined();
    if (capturedHeaders) {
      expect(capturedHeaders['User-Agent']).toBe('Elefant/0.1.0');
    }
  });

  it('should handle complex nested script and style blocks', async () => {
    const mockHtml = `
      <html>
        <head>
          <style type="text/css">
            /* CSS comment */
            body { margin: 0; }
          </style>
        </head>
        <body>
          <div>Before script</div>
          <script type="text/javascript">
            // JavaScript comment
            function evil() {
              return "bad";
            }
          </script>
          <div>After script</div>
          <style>
            .class { color: blue; }
          </style>
          <div>Final content</div>
        </body>
      </html>
    `;

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Before script');
      expect(result.data).toContain('After script');
      expect(result.data).toContain('Final content');
      expect(result.data).not.toContain('evil');
      expect(result.data).not.toContain('function');
      expect(result.data).not.toContain('CSS comment');
      expect(result.data).not.toContain('color: blue');
    }
  });

  it('should handle empty HTML gracefully', async () => {
    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '',
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('');
    }
  });

  it('should handle HTML with only scripts/styles (empty after sanitization)', async () => {
    const mockHtml = `
      <script>alert('xss')</script>
      <style>body { color: red; }</style>
    `;

    globalThis.fetch = mock(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response)
    ) as unknown as typeof globalThis.fetch;

    const result = await webfetchTool.execute({
      url: 'https://example.com',
      format: 'markdown',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should be empty or whitespace-only after stripping
      expect(result.data.trim()).toBe('');
    }
  });
});
