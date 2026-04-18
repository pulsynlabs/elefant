import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface LspSymbol {
  name: string;
  kind: number;
  location?: Location;
  containerName?: string;
  children?: LspSymbol[];
}

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ReaderLike = {
  read: () => Promise<{ done: boolean; value?: Uint8Array<ArrayBufferLike> }>;
  releaseLock: () => void;
};

type ReadableWithReader = {
  getReader: () => ReaderLike;
};

type WritableWithWriter = {
  getWriter: () => WritableStreamDefaultWriter<Uint8Array>;
};

type WritableWithWrite = {
  write: (chunk: Uint8Array) => unknown;
};

const HEADER_DELIMITER = new Uint8Array([13, 10, 13, 10]); // \r\n\r\n
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function findHeaderDelimiter(buffer: Uint8Array<ArrayBufferLike>): number {
  for (let i = 0; i <= buffer.length - HEADER_DELIMITER.length; i++) {
    if (
      buffer[i] === HEADER_DELIMITER[0]
      && buffer[i + 1] === HEADER_DELIMITER[1]
      && buffer[i + 2] === HEADER_DELIMITER[2]
      && buffer[i + 3] === HEADER_DELIMITER[3]
    ) {
      return i;
    }
  }
  return -1;
}

function concatBytes(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  const merged = new Uint8Array(a.length + b.length);
  merged.set(a, 0);
  merged.set(b, a.length);
  return merged;
}

function getLanguageId(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.ts' || extension === '.tsx') {
    return 'typescript';
  }
  if (extension === '.js' || extension === '.jsx') {
    return 'javascript';
  }
  return 'plaintext';
}

function toFileUri(filePath: string): string {
  return pathToFileURL(filePath).toString();
}

function toPosition(value: unknown): Position | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const maybe = value as { line?: unknown; character?: unknown };
  if (typeof maybe.line !== 'number' || typeof maybe.character !== 'number') {
    return null;
  }

  return {
    line: maybe.line,
    character: maybe.character,
  };
}

function toRange(value: unknown): Range | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const maybe = value as { start?: unknown; end?: unknown };
  const start = toPosition(maybe.start);
  const end = toPosition(maybe.end);
  if (!start || !end) {
    return null;
  }

  return { start, end };
}

function normalizeLocation(value: unknown): Location | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const direct = value as { uri?: unknown; range?: unknown };
  if (typeof direct.uri === 'string') {
    const directRange = toRange(direct.range);
    if (directRange) {
      return {
        uri: direct.uri,
        range: directRange,
      };
    }
  }

  const link = value as {
    targetUri?: unknown;
    targetRange?: unknown;
    targetSelectionRange?: unknown;
  };

  if (typeof link.targetUri !== 'string') {
    return null;
  }

  const linkRange = toRange(link.targetSelectionRange) ?? toRange(link.targetRange);
  if (!linkRange) {
    return null;
  }

  return {
    uri: link.targetUri,
    range: linkRange,
  };
}

function normalizeLocations(value: unknown): Location[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeLocation(item))
      .filter((item): item is Location => item !== null);
  }

  const single = normalizeLocation(value);
  return single ? [single] : [];
}

function hoverToText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const hover = value as { contents?: unknown };
  const contents = hover.contents;
  if (contents === null || contents === undefined) {
    return null;
  }

  if (typeof contents === 'string') {
    return contents;
  }

  if (Array.isArray(contents)) {
    const parts = contents
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (typeof entry === 'object' && entry !== null) {
          const maybe = entry as { value?: unknown; language?: unknown };
          if (typeof maybe.value === 'string' && typeof maybe.language === 'string') {
            return `\`\`\`${maybe.language}\n${maybe.value}\n\`\`\``;
          }
          if (typeof maybe.value === 'string') {
            return maybe.value;
          }
        }

        return '';
      })
      .filter((part) => part.length > 0);

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  if (typeof contents === 'object') {
    const maybe = contents as { value?: unknown; language?: unknown };
    if (typeof maybe.value === 'string' && typeof maybe.language === 'string') {
      return `\`\`\`${maybe.language}\n${maybe.value}\n\`\`\``;
    }
    if (typeof maybe.value === 'string') {
      return maybe.value;
    }
  }

  return null;
}

function normalizeDocumentSymbol(value: unknown): LspSymbol | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const symbol = value as {
    name?: unknown;
    kind?: unknown;
    location?: unknown;
    range?: unknown;
    children?: unknown;
    containerName?: unknown;
  };

  if (typeof symbol.name !== 'string' || typeof symbol.kind !== 'number') {
    return null;
  }

  let location: Location | undefined;
  if (symbol.location) {
    const maybeLocation = normalizeLocation(symbol.location);
    if (maybeLocation) {
      location = maybeLocation;
    }
  } else if (symbol.range) {
    const range = toRange(symbol.range);
    if (range) {
      location = {
        uri: '',
        range,
      };
    }
  }

  const children = Array.isArray(symbol.children)
    ? symbol.children
      .map((child) => normalizeDocumentSymbol(child))
      .filter((child): child is LspSymbol => child !== null)
    : undefined;

  return {
    name: symbol.name,
    kind: symbol.kind,
    location,
    containerName: typeof symbol.containerName === 'string' ? symbol.containerName : undefined,
    children,
  };
}

function normalizeDocumentSymbols(value: unknown, fallbackUri: string): LspSymbol[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => normalizeDocumentSymbol(item))
    .filter((item): item is LspSymbol => item !== null)
    .map((item) => {
      if (item.location && item.location.uri.length === 0) {
        return {
          ...item,
          location: {
            ...item.location,
            uri: fallbackUri,
          },
        };
      }
      return item;
    });

  return normalized;
}

function normalizeWorkspaceSymbols(value: unknown): LspSymbol[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeDocumentSymbol(item))
    .filter((item): item is LspSymbol => item !== null)
    .map((item) => {
      if (!item.location || item.location.uri.length > 0) {
        return item;
      }
      return {
        ...item,
        location: undefined,
      };
    });
}

export class LspClient {
  private readonly reader: ReaderLike;
  private readonly writeFn: (chunk: Uint8Array) => Promise<void>;
  private readonly releaseWriterLock: () => void;
  private readBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private nextId = 1;
  private initialized = false;
  private pending = new Map<number, PendingRequest>();
  private writeChain: Promise<void> = Promise.resolve();
  private openDocuments = new Set<string>();
  private disposed = false;

  constructor(private readonly process: ReturnType<typeof Bun.spawn>) {
    const stdout = process.stdout;
    const stdin = process.stdin;

    if (!stdout || !stdin) {
      throw new Error('LSP process must be spawned with stdin/stdout pipes');
    }

    if (typeof stdout === 'number') {
      throw new Error('LSP process stdout must be piped');
    }

    if (typeof stdin === 'number') {
      throw new Error('LSP process stdin must be piped');
    }

    if (!this.hasGetReader(stdout)) {
      throw new Error('Unsupported stdout pipe type for LSP process');
    }

    this.reader = stdout.getReader();

    if (this.hasGetWriter(stdin)) {
      const writer = stdin.getWriter();
      this.writeFn = async (chunk) => {
        await writer.write(chunk);
      };
      this.releaseWriterLock = () => {
        writer.releaseLock();
      };
    } else if (this.hasWrite(stdin)) {
      this.writeFn = async (chunk) => {
        await Promise.resolve(stdin.write(chunk));
      };
      this.releaseWriterLock = () => {};
    } else {
      throw new Error('Unsupported stdin pipe type for LSP process');
    }

    this.startReadLoop();
  }

  async initialize(rootUri: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.sendRequest('initialize', {
      processId: null,
      rootUri,
      capabilities: {},
      clientInfo: {
        name: 'elefant',
      },
    }, 30_000);

    await this.sendNotification('initialized', {});
    this.initialized = true;
  }

  async goToDefinition(filePath: string, pos: Position): Promise<Location[]> {
    const uri = toFileUri(filePath);
    await this.ensureDocumentOpened(filePath, uri);

    const response = await this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: pos,
    });

    return normalizeLocations(response);
  }

  async findReferences(filePath: string, pos: Position): Promise<Location[]> {
    const uri = toFileUri(filePath);
    await this.ensureDocumentOpened(filePath, uri);

    const response = await this.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: pos,
      context: {
        includeDeclaration: true,
      },
    });

    return normalizeLocations(response);
  }

  async hover(filePath: string, pos: Position): Promise<string | null> {
    const uri = toFileUri(filePath);
    await this.ensureDocumentOpened(filePath, uri);

    const response = await this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: pos,
    });

    return hoverToText(response);
  }

  async documentSymbols(filePath: string): Promise<LspSymbol[]> {
    const uri = toFileUri(filePath);
    await this.ensureDocumentOpened(filePath, uri);

    const response = await this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    });

    return normalizeDocumentSymbols(response, uri);
  }

  async workspaceSymbols(query: string): Promise<LspSymbol[]> {
    const response = await this.sendRequest('workspace/symbol', { query });
    return normalizeWorkspaceSymbols(response);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`LSP client disposed (request ${id})`));
    }
    this.pending.clear();

    try {
      this.releaseWriterLock();
    } catch {
      // ignore
    }
    try {
      this.reader.releaseLock();
    } catch {
      // ignore
    }

    this.process.kill();
  }

  private async ensureDocumentOpened(filePath: string, uri: string): Promise<void> {
    if (this.openDocuments.has(uri)) {
      return;
    }

    let text = '';
    try {
      text = await Bun.file(filePath).text();
    } catch {
      text = '';
    }

    await this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: getLanguageId(filePath),
        version: 1,
        text,
      },
    });

    this.openDocuments.add(uri);
  }

  private startReadLoop(): void {
    void (async () => {
      try {
        while (!this.disposed) {
          const { done, value } = await this.reader.read();
          if (done) {
            break;
          }
          if (!value) {
            continue;
          }

          this.readBuffer = concatBytes(this.readBuffer, value);
          this.processIncomingMessages();
        }
      } catch (error) {
        this.failAllPending(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  }

  private processIncomingMessages(): void {
    while (true) {
      const headerEnd = findHeaderDelimiter(this.readBuffer);
      if (headerEnd < 0) {
        return;
      }

      const headerBytes = this.readBuffer.slice(0, headerEnd);
      const headerText = textDecoder.decode(headerBytes);
      const match = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!match) {
        this.failAllPending(new Error('Malformed LSP message: missing Content-Length'));
        this.dispose();
        return;
      }

      const contentLength = Number.parseInt(match[1]!, 10);
      const bodyStart = headerEnd + HEADER_DELIMITER.length;
      const bodyEnd = bodyStart + contentLength;

      if (this.readBuffer.length < bodyEnd) {
        return;
      }

      const bodyBytes = this.readBuffer.slice(bodyStart, bodyEnd);
      this.readBuffer = this.readBuffer.slice(bodyEnd);

      const jsonText = textDecoder.decode(bodyBytes);
      let message: unknown;
      try {
        message = JSON.parse(jsonText);
      } catch {
        continue;
      }

      this.handleMessage(message);
    }
  }

  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      return;
    }

    const response = message as JsonRpcResponse;
    if (typeof response.id !== 'number') {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if (response.error) {
      pending.reject(new Error(`LSP error ${response.error.code}: ${response.error.message}`));
      return;
    }

    pending.resolve(response.result);
  }

  private async sendNotification(method: string, params?: unknown): Promise<void> {
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    await this.writeMessage(message);
  }

  private async sendRequest(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;

    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    await this.writeMessage(message);

    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
      });
    });
  }

  private async writeMessage(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    const payload = textEncoder.encode(JSON.stringify(message));
    const header = textEncoder.encode(`Content-Length: ${payload.byteLength}\r\n\r\n`);
    const framed = concatBytes(header, payload);

    this.writeChain = this.writeChain.then(async () => {
      await this.writeFn(framed);
    });

    await this.writeChain;
  }

  private failAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private hasGetWriter(value: unknown): value is WritableWithWriter {
    return typeof value === 'object' && value !== null && 'getWriter' in value && typeof (value as { getWriter?: unknown }).getWriter === 'function';
  }

  private hasGetReader(value: unknown): value is ReadableWithReader {
    return typeof value === 'object' && value !== null && 'getReader' in value && typeof (value as { getReader?: unknown }).getReader === 'function';
  }

  private hasWrite(value: unknown): value is WritableWithWrite {
    return typeof value === 'object' && value !== null && 'write' in value && typeof (value as { write?: unknown }).write === 'function';
  }
}
