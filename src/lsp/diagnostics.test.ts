import { describe, expect, it } from 'bun:test';
import { pathToFileURL } from 'node:url';

import { LspClient } from '../tools/lsp/client.js';
import { LspService } from './service.js';
import type { LspDiagnostic } from './types.js';

type NotificationHandler = (params: unknown) => void;

interface MinimalClient {
  onNotification(method: string, handler: NotificationHandler): void;
  dispose(): void;
}

interface TestableLspService {
  registerNotificationHandlers(client: LspClient, serverId: string): void;
}

function createMockClient(): { client: MinimalClient; publishDiagnostics: NotificationHandler } {
  const handlers = new Map<string, NotificationHandler>();
  const client: MinimalClient = {
    onNotification(method, handler) {
      handlers.set(method, handler);
    },
    dispose() {},
  };

  return {
    client,
    publishDiagnostics(params: unknown) {
      const handler = handlers.get('textDocument/publishDiagnostics');
      if (!handler) {
        throw new Error('publishDiagnostics handler was not registered');
      }
      handler(params);
    },
  };
}

function registerMockClient(service: LspService): ReturnType<typeof createMockClient> {
  const mockClient = createMockClient();
  (service as unknown as TestableLspService).registerNotificationHandlers(
    mockClient.client as unknown as LspClient,
    'typescript',
  );
  return mockClient;
}

function diagnostic(message: string): LspDiagnostic {
  return {
    range: {
      start: { line: 1, character: 2 },
      end: { line: 1, character: 8 },
    },
    severity: 1,
    message,
  };
}

describe('LspService diagnostics', () => {
  it('stores publishDiagnostics notifications by normalized absolute path', async () => {
    const service = new LspService([]);
    const client = registerMockClient(service);
    const filePath = '/tmp/elefant-diagnostics.ts';
    const diagnostics = [diagnostic('Type mismatch')];

    client.publishDiagnostics({
      uri: pathToFileURL(filePath).toString(),
      diagnostics,
    });

    await expect(service.diagnostics()).resolves.toEqual({
      [filePath]: diagnostics,
    });
  });

  it('replaces diagnostics for the same file instead of appending', async () => {
    const service = new LspService([]);
    const client = registerMockClient(service);
    const filePath = '/tmp/elefant-diagnostics-replace.ts';

    client.publishDiagnostics({
      uri: pathToFileURL(filePath).toString(),
      diagnostics: [diagnostic('First error')],
    });
    client.publishDiagnostics({
      uri: pathToFileURL(filePath).toString(),
      diagnostics: [diagnostic('Second error')],
    });

    expect(service.getDiagnosticsFor(filePath)).toEqual([diagnostic('Second error')]);
  });

  it('removes a file entry when an empty diagnostics array is published', async () => {
    const service = new LspService([]);
    const client = registerMockClient(service);
    const filePath = '/tmp/elefant-diagnostics-clear.ts';

    client.publishDiagnostics({
      uri: pathToFileURL(filePath).toString(),
      diagnostics: [diagnostic('Temporary error')],
    });
    client.publishDiagnostics({
      uri: pathToFileURL(filePath).toString(),
      diagnostics: [],
    });

    await expect(service.diagnostics()).resolves.toEqual({});
  });

  it('returns a plain object snapshot instead of exposing the internal map', async () => {
    const service = new LspService([]);
    const client = registerMockClient(service);
    const filePath = '/tmp/elefant-diagnostics-snapshot.ts';

    client.publishDiagnostics({
      uri: pathToFileURL(filePath).toString(),
      diagnostics: [diagnostic('Stored error')],
    });

    const snapshot = await service.diagnostics();
    snapshot[filePath] = [];

    expect(snapshot).not.toBeInstanceOf(Map);
    expect(service.getDiagnosticsFor(filePath)).toEqual([diagnostic('Stored error')]);
  });

  it('returns an empty array for unknown files', () => {
    const service = new LspService([]);

    expect(service.getDiagnosticsFor('/tmp/unknown.ts')).toEqual([]);
  });

  it('silently ignores non-file URIs', async () => {
    const service = new LspService([]);
    const client = registerMockClient(service);

    client.publishDiagnostics({
      uri: 'untitled:Untitled-1',
      diagnostics: [diagnostic('Ignored error')],
    });

    await expect(service.diagnostics()).resolves.toEqual({});
  });
});
