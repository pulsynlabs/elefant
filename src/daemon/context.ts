/**
 * DaemonContext — shared state container for the Elefant daemon.
 */

import type { HookRegistry } from '../hooks/index.ts';
import type { ToolRegistry } from '../tools/registry.ts';
import type { ProviderRouter } from '../providers/router.ts';
import type { ProjectInfo } from '../project/types.ts';
import type { Database } from '../db/database.ts';
import type { ElefantConfig } from '../config/index.ts';
import type { StateManager } from '../state/manager.ts';
import type { PluginLoader } from '../plugins/loader.ts';
import type { ElefantWsServer } from '../transport/ws-server.ts';
import type { SseManager } from '../transport/sse-manager.ts';
import type { PermissionGate } from '../permissions/gate.ts';

export interface DaemonContext {
  config: ElefantConfig;
  hooks: HookRegistry;
  tools: ToolRegistry;
  providers: ProviderRouter;
  project: ProjectInfo;
  db: Database;
  state: StateManager;
  plugins: PluginLoader;
  ws: ElefantWsServer;
  sse: SseManager;
  permissions: PermissionGate;
}
