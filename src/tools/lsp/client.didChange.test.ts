import { describe, expect, it, mock } from 'bun:test';

import { LspClient } from './client.js';

type MockTransport = {
  client: LspClient;
  written: Uint8Array[];
  sendServerMessage: (message: unknown) => void;
  dispose: () => void;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function frameMessage(message: unknown): Uint8Array {
  const payload = textEncoder.encode(JSON.stringify(message));
  const header = textEncoder.encode(`Content-Length: ${payload.byteLength}\r\n\r\n`);
  const framed = new Uint8Array(header.byteLength + payload.byteLength);
  framed.set(header, 0);
  framed.set(payload, header.byteLength);
  return framed;
}

function decodeFrame(chunk: Uint8Array): Record<string, unknown> {
  const text = textDecoder.decode(chunk);
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd < 0) {
    throw new Error('Malformed framed message');
  }
  return JSON.parse(text.slice(headerEnd + 4)) as Record<string, unknown>;
}

function paramsOf(message: Record<string, unknown>): Record<string, unknown> {
  expect(typeof message.params).toBe('object');
  expect(message.params).not.toBeNull();
  return message.params as Record<string, unknown>;
}

function createMockTransport(): MockTransport {
  const written: Uint8Array[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const kill = mock(() => {});

  const stdout = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  const stdin = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(chunk);
    },
  });

  const process = {
    stdin,
    stdout,
    stderr: new ReadableStream<Uint8Array>(),
    kill,
  } as unknown as ReturnType<typeof Bun.spawn>;

  const client = new LspClient(process);

  return {
    client,
    written,
    sendServerMessage(message) {
      if (!controller) {
        throw new Error('Mock stdout controller not initialized');
      }
      controller.enqueue(frameMessage(message));
    },
    dispose() {
      client.dispose();
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error('Timed out waiting for condition');
}

async function openDocument(transport: MockTransport, filePath: string): Promise<void> {
  const promise = transport.client.goToDefinition(filePath, { line: 0, character: 0 });
  await waitFor(() => transport.written.length >= 2);
  await Promise.resolve();
  transport.sendServerMessage({ jsonrpc: '2.0', id: 1, result: [] });
  await promise;
}

describe('LspClient document synchronization', () => {
  it('dispatches registered notification handlers', async () => {
    const transport = createMockTransport();
    try {
      const handler = mock((_params: unknown) => {});
      transport.client.onNotification('textDocument/publishDiagnostics', handler);

      const params = {
        uri: 'file:///tmp/example.ts',
        diagnostics: [{ message: 'Type mismatch' }],
      };
      transport.sendServerMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params,
      });

      await waitFor(() => handler.mock.calls.length === 1);
      expect(handler).toHaveBeenCalledWith(params);
    } finally {
      transport.dispose();
    }
  });

  it('sends didChange with version 2 for an already-open document', async () => {
    const transport = createMockTransport();
    try {
      const filePath = '/tmp/elefant-lsp-client-already-open.ts';
      await openDocument(transport, filePath);

      await transport.client.didChange(filePath, 'const value = 2;');

      const didChange = decodeFrame(transport.written[2]!);
      const params = paramsOf(didChange);
      const textDocument = params.textDocument as Record<string, unknown>;
      const contentChanges = params.contentChanges as Array<Record<string, unknown>>;

      expect(didChange.method).toBe('textDocument/didChange');
      expect(textDocument.version).toBe(2);
      expect(contentChanges).toEqual([{ text: 'const value = 2;' }]);
    } finally {
      transport.dispose();
    }
  });

  it('opens the document internally when didChange is called first', async () => {
    const transport = createMockTransport();
    try {
      const filePath = '/tmp/elefant-lsp-client-first-touch.ts';

      await expect(transport.client.didChange(filePath, 'const value = 1;')).resolves.toBeUndefined();

      const didOpen = decodeFrame(transport.written[0]!);
      const didChange = decodeFrame(transport.written[1]!);
      const didChangeParams = paramsOf(didChange);
      const textDocument = didChangeParams.textDocument as Record<string, unknown>;

      expect(didOpen.method).toBe('textDocument/didOpen');
      expect(didChange.method).toBe('textDocument/didChange');
      expect(textDocument.version).toBe(2);
    } finally {
      transport.dispose();
    }
  });

  it('sends didSave notifications', async () => {
    const transport = createMockTransport();
    try {
      const filePath = '/tmp/elefant-lsp-client-save.ts';

      await transport.client.didSave(filePath);

      const didSave = decodeFrame(transport.written[0]!);
      const params = paramsOf(didSave);
      const textDocument = params.textDocument as Record<string, unknown>;

      expect(didSave.method).toBe('textDocument/didSave');
      expect(textDocument.uri).toBe('file:///tmp/elefant-lsp-client-save.ts');
    } finally {
      transport.dispose();
    }
  });

  it('increments document versions monotonically on repeated didChange calls', async () => {
    const transport = createMockTransport();
    try {
      const filePath = '/tmp/elefant-lsp-client-versions.ts';

      await transport.client.didChange(filePath, 'version 2');
      await transport.client.didChange(filePath, 'version 3');
      await transport.client.didChange(filePath, 'version 4');

      const didChangeMessages = transport.written
        .map(decodeFrame)
        .filter((message) => message.method === 'textDocument/didChange');
      const versions = didChangeMessages.map((message) => {
        const params = paramsOf(message);
        const textDocument = params.textDocument as Record<string, unknown>;
        return textDocument.version;
      });

      expect(versions).toEqual([2, 3, 4]);
    } finally {
      transport.dispose();
    }
  });

  it('continues resolving responses after receiving notifications', async () => {
    const transport = createMockTransport();
    try {
      const handler = mock((_params: unknown) => {});
      transport.client.onNotification('textDocument/publishDiagnostics', handler);

      const symbolsPromise = transport.client.workspaceSymbols('Example');
      await waitFor(() => transport.written.length === 1);
      await Promise.resolve();

      transport.sendServerMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: 'file:///tmp/example.ts', diagnostics: [] },
      });
      transport.sendServerMessage({
        jsonrpc: '2.0',
        id: 1,
        result: [{ name: 'Example', kind: 12, location: { uri: 'file:///tmp/example.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } } } }],
      });

      const symbols = await symbolsPromise;

      expect(handler).toHaveBeenCalledTimes(1);
      expect(symbols).toEqual([
        {
          name: 'Example',
          kind: 12,
          location: {
            uri: 'file:///tmp/example.ts',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 7 },
            },
          },
          containerName: undefined,
          children: undefined,
        },
      ]);
    } finally {
      transport.dispose();
    }
  });
});
