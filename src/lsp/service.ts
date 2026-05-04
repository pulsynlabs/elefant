import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LspClient } from '../tools/lsp/client.js';
import { ALL_SERVERS } from './servers.js';
import type { LspDiagnostic, ServerInfo } from './types.js';
import { extensionToServerIds } from './language.js';

/** Per-server-instance state keyed by `${serverId}::${root}` */
interface ClientEntry {
  client: LspClient;
  serverId: string;
  root: string;
}

export interface LspServiceFacade {
  touchFile(filePath: string, waitForDiagnostics?: boolean): Promise<void>;
  diagnostics(): Promise<Record<string, LspDiagnostic[]>>;
  dispose(): Promise<void>;
}

export class LspService implements LspServiceFacade {
  private readonly clients = new Map<string, ClientEntry>();
  private readonly spawning = new Map<string, Promise<LspClient | undefined>>();
  private readonly diagnosticStore = new Map<string, LspDiagnostic[]>();
  private servers: ServerInfo[];

  constructor(servers: ServerInfo[] = ALL_SERVERS) {
    this.servers = servers;
  }

  /** Called by write/edit tools after a successful file write */
  async touchFile(filePath: string, waitForDiagnostics = false): Promise<void> {
    // STUB — Wave 2 implements the real logic.
    const extension = extname(filePath);
    const uri = pathToFileURL(filePath).toString();
    const serverIds = extensionToServerIds(filePath);
    const matchingServers = this.servers.filter((server) => serverIds.includes(server.id));

    void extension;
    void uri;
    void matchingServers;
    void waitForDiagnostics;
  }

  /** Returns a snapshot of all current diagnostics keyed by absolute file path */
  async diagnostics(): Promise<Record<string, LspDiagnostic[]>> {
    // STUB — Wave 2 fills this in from the diagnostic store.
    return Object.fromEntries(this.diagnosticStore);
  }

  async dispose(): Promise<void> {
    for (const entry of this.clients.values()) {
      entry.client.dispose();
    }
    this.clients.clear();
    this.spawning.clear();
    this.diagnosticStore.clear();
  }
}

/** Module-level singleton — replaced in tests via createLspService() */
let _instance: LspService | undefined;

export function getLspService(): LspService {
  if (!_instance) {
    _instance = new LspService();
  }
  return _instance;
}

export function createLspService(servers?: ServerInfo[]): LspService {
  const svc = new LspService(servers);
  _instance = svc;
  return svc;
}

export function resetLspService(): void {
  if (_instance) {
    void _instance.dispose();
    _instance = undefined;
  }
}
