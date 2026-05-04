import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { LspClient } from '../tools/lsp/client.js';
import { triggerInstall, hasFailed, isInstalling } from './installer.js';
import { ALL_SERVERS } from './servers.js';
import type { LspDiagnostic, ServerInfo } from './types.js';
import { extensionToServerIds } from './language.js';

/** Per-server-instance state keyed by `${serverId}::${root}` */
interface ClientEntry {
  client: LspClient;
  serverId: string;
  root: string;
}

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: LspDiagnostic[];
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
  private readonly diagnosticsEmitter = new EventEmitter();
  private servers: ServerInfo[];

  constructor(servers: ServerInfo[] = ALL_SERVERS) {
    this.servers = servers;
  }

  /** Called by write/edit tools after a successful file write */
  async touchFile(filePath: string, waitForDiagnostics = false): Promise<void> {
    const serverIds = extensionToServerIds(filePath);
    if (serverIds.length === 0) {
      return;
    }

    const matchingServers = this.servers.filter((server) => serverIds.includes(server.id));
    if (matchingServers.length === 0) {
      return;
    }

    const waitPromises: Promise<void>[] = [];

    for (const server of matchingServers) {
      const client = await this.getOrSpawnClient(server, filePath);
      if (!client) {
        continue;
      }

      let text = '';
      try {
        text = await Bun.file(filePath).text();
      } catch {
        text = '';
      }

      await client.didChange(filePath, text);
      await client.didSave(filePath);

      if (waitForDiagnostics) {
        waitPromises.push(this.waitForDiagnostics(filePath));
      }
    }

    if (waitPromises.length > 0) {
      await Promise.race([
        Promise.all(waitPromises),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
  }

  private async getOrSpawnClient(server: ServerInfo, filePath: string): Promise<LspClient | undefined> {
    const root = await server.root(filePath);
    if (!root) {
      return undefined;
    }

    const key = `${server.id}::${root}`;
    const existing = this.clients.get(key);
    if (existing) {
      return existing.client;
    }

    const inFlight = this.spawning.get(key);
    if (inFlight) {
      return inFlight;
    }

    const spawnPromise = (async (): Promise<LspClient | undefined> => {
      try {
        const handle = await server.spawn(root);
        if (!handle) {
          // Binary not found — trigger background install if available and not already attempted
          if (server.install && !hasFailed(server.id) && !isInstalling(server.id)) {
            triggerInstall(server.id, server.install);
          }
          return undefined;
        }

        const client = new LspClient(handle.process);
        await client.initialize(`file://${root}`);

        this.registerNotificationHandlers(client, server.id);
        this.clients.set(key, { client, serverId: server.id, root });
        return client;
      } catch {
        return undefined;
      } finally {
        this.spawning.delete(key);
      }
    })();

    this.spawning.set(key, spawnPromise);
    return spawnPromise;
  }

  private waitForDiagnostics(filePath: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      let hardCapTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        this.diagnosticsEmitter.off('diagnostics', handler);
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        if (hardCapTimer) {
          clearTimeout(hardCapTimer);
        }
      };

      const handler = (path: string) => {
        if (path !== filePath) {
          return;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          cleanup();
          resolve();
        }, 150);
      };

      hardCapTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, 3000);

      this.diagnosticsEmitter.on('diagnostics', handler);
    });
  }

  /** Returns a snapshot of all current diagnostics keyed by absolute file path */
  async diagnostics(): Promise<Record<string, LspDiagnostic[]>> {
    return Object.fromEntries(this.diagnosticStore);
  }

  getDiagnosticsFor(filePath: string): LspDiagnostic[] {
    return this.diagnosticStore.get(filePath) ?? [];
  }

  /**
   * Returns the active LspClient for a file path, lazily spawning a server
   * if one matches but hasn't been started yet. Returns undefined if no
   * server matches the file extension or all matching servers fail to spawn.
   */
  async getClientForFile(filePath: string): Promise<LspClient | undefined> {
    const serverIds = extensionToServerIds(filePath);
    const matchingServers = this.servers.filter((s) => serverIds.includes(s.id));
    for (const server of matchingServers) {
      const root = await server.root(filePath);
      if (!root) continue;
      const key = `${server.id}::${root}`;
      const entry = this.clients.get(key);
      if (entry) return entry.client;
      // Lazy-spawn if not yet started
      const client = await this.getOrSpawnClient(server, filePath);
      if (client) return client;
    }
    return undefined;
  }

  async dispose(): Promise<void> {
    for (const entry of this.clients.values()) {
      entry.client.dispose();
    }
    this.clients.clear();
    this.spawning.clear();
    this.diagnosticStore.clear();
    this.diagnosticsEmitter.removeAllListeners();
  }

  registerNotificationHandlers(client: LspClient, _serverId: string): void {
    client.onNotification('textDocument/publishDiagnostics', (params) => {
      const p = params as PublishDiagnosticsParams;
      if (!p?.uri) {
        return;
      }

      let absPath: string;
      try {
        absPath = fileURLToPath(p.uri);
      } catch {
        return;
      }

      if (!p.diagnostics || p.diagnostics.length === 0) {
        this.diagnosticStore.delete(absPath);
      } else {
        this.diagnosticStore.set(absPath, p.diagnostics);
      }

      this.diagnosticsEmitter.emit('diagnostics', absPath);
    });
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
