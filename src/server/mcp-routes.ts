import { Elysia } from 'elysia';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { configSchema, mcpServerSchema, type ElefantConfig, type McpServerConfig } from '../config/schema.ts';
import type { MCPManager } from '../mcp/manager.ts';
import type { MCPServerStatus } from '../mcp/types.ts';
import { fetchAnthropicRegistry, invalidateAnthropicCache, prefetchAnthropicRegistry } from '../mcp/registry/anthropic.ts';
import { fetchSmitheryRegistry } from '../mcp/registry/smithery.ts';
import { getBundledRegistry } from '../mcp/registry/bundled.ts';
import type { SseManager } from '../transport/sse-manager.ts';
import { mcpSessionOverlay } from './mcp-session-overlay.ts';

const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'elefant', 'elefant.config.json');
export const MCP_EVENTS_PROJECT_ID = '__global_mcp__';

const PinToolSchema = z.object({
  toolName: z.string().min(1),
  pinned: z.boolean(),
});

const RegistrySourceSchema = z.enum(['anthropic', 'smithery', 'bundled', 'all']);

interface McpRoutesOptions {
  configPath?: string;
  sseManager?: SseManager;
}

async function readConfigFile(configPath: string): Promise<ElefantConfig | null> {
  try {
    const file = Bun.file(configPath);
    if (!(await file.exists())) {
      return null;
    }
    const raw = await file.json();
    const parsed = configSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeConfigFile(configPath: string, config: ElefantConfig): Promise<void> {
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function serverSummary(
  config: McpServerConfig,
  status?: MCPServerStatus,
  error?: string,
  toolCount?: number,
  pinnedTools?: string[],
) {
  return {
    id: config.id,
    name: config.name,
    transport: config.transport,
    enabled: config.enabled,
    status: status ?? (config.enabled === false ? 'disabled' : 'unknown'),
    error,
    toolCount: toolCount ?? 0,
    pinnedTools: pinnedTools ?? [],
  };
}

export function createMcpRoutes<TApp extends Elysia>(app: TApp, mcpManager: MCPManager, options: McpRoutesOptions = {}): TApp {
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  if (options.sseManager) {
    app.get('/api/mcp/events', () => options.sseManager!.subscribe(MCP_EVENTS_PROJECT_ID));
  }

  // --- Server CRUD ---

  app.get('/api/mcp/servers', async () => {
    const config = await readConfigFile(configPath);
    if (!config) {
      return { ok: true, data: [] };
    }

    const allTools = mcpManager.listAllTools();

    const servers = config.mcp.map((serverConfig) => {
      const status = mcpManager.getStatus(serverConfig.id);
      const toolCount = allTools.filter((t) => t.serverId === serverConfig.id).length;
      return serverSummary(
        serverConfig,
        status,
        undefined,
        toolCount,
        serverConfig.pinnedTools ?? [],
      );
    });

    return { ok: true, data: servers };
  });

  app.get('/api/mcp/servers/:id', async ({ params, set }) => {
    const config = await readConfigFile(configPath);
    if (!config) {
      set.status = 404;
      return { ok: false, error: 'Server not found' };
    }

    const serverConfig = config.mcp.find((s) => s.id === params.id);
    if (!serverConfig) {
      set.status = 404;
      return { ok: false, error: 'Server not found' };
    }

    const status = mcpManager.getStatus(serverConfig.id);
    const allTools = mcpManager.listAllTools();
    const toolCount = allTools.filter((t) => t.serverId === serverConfig.id).length;

    return {
      ok: true,
      data: serverSummary(
        serverConfig,
        status,
        undefined,
        toolCount,
        serverConfig.pinnedTools ?? [],
      ),
    };
  });

  app.post('/api/mcp/servers', async ({ body, set }) => {
    const parsed = mcpServerSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { ok: false, error: 'Invalid MCP server configuration', details: parsed.error.issues };
    }

    const config = await readConfigFile(configPath);
    const existing = config ?? configSchema.parse({});

    // Check for name uniqueness
    if (existing.mcp.some((s) => s.name === parsed.data.name)) {
      set.status = 409;
      return { ok: false, error: `MCP server "${parsed.data.name}" already exists` };
    }

    const updated: ElefantConfig = {
      ...existing,
      mcp: [...existing.mcp, parsed.data],
    };

    await writeConfigFile(configPath,updated);

    // Attempt connection in the background
    void mcpManager.connect(parsed.data.id);

    set.status = 201;
    return { ok: true, data: serverSummary(parsed.data, 'connecting', undefined, 0) };
  });

  app.put('/api/mcp/servers/:id', async ({ params, body, set }) => {
    const parsed = mcpServerSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { ok: false, error: 'Invalid MCP server configuration', details: parsed.error.issues };
    }

    const config = await readConfigFile(configPath);
    if (!config) {
      set.status = 404;
      return { ok: false, error: 'No config file found' };
    }

    const index = config.mcp.findIndex((s) => s.id === params.id);
    if (index === -1) {
      set.status = 404;
      return { ok: false, error: `MCP server "${params.id}" not found` };
    }

    config.mcp[index] = parsed.data;
    await writeConfigFile(configPath,config);

    // Reconnect with updated config
    void mcpManager.reconnect(parsed.data.id);

    return { ok: true, data: serverSummary(parsed.data, 'connecting', undefined, 0) };
  });

  app.delete('/api/mcp/servers/:id', async ({ params, set }) => {
    const config = await readConfigFile(configPath);
    if (!config) {
      set.status = 404;
      return { ok: false, error: 'No config file found' };
    }

    const before = config.mcp.length;
    config.mcp = config.mcp.filter((s) => s.id !== params.id);

    if (config.mcp.length === before) {
      set.status = 404;
      return { ok: false, error: `MCP server "${params.id}" not found` };
    }

    await writeConfigFile(configPath,config);

    // Disconnect and remove
    await mcpManager.disconnect(params.id);

    return { ok: true, data: { deleted: params.id } };
  });

  // --- Connect / Disconnect ---

  app.post('/api/mcp/servers/:id/connect', async ({ params }) => {
    await mcpManager.reconnect(params.id);
    const status = mcpManager.getStatus(params.id);
    return { ok: true, data: { id: params.id, status: status ?? 'unknown' } };
  });

  app.post('/api/mcp/servers/:id/disconnect', async ({ params }) => {
    await mcpManager.disconnect(params.id);
    return { ok: true, data: { id: params.id, status: 'disabled' } };
  });

  // --- Session-scoped server overlay (in-memory only) ---

  app.post('/api/projects/:projectId/sessions/:sessionId/mcp/:serverId/disable', async ({ params }) => {
    mcpSessionOverlay.disable(params.sessionId, params.serverId);
    options.sseManager?.publishVolatile(MCP_EVENTS_PROJECT_ID, 'mcp.session.toggled', {
      sessionId: params.sessionId,
      serverId: params.serverId,
      disabled: true,
    });

    return {
      ok: true,
      serverId: params.serverId,
      sessionId: params.sessionId,
      disabled: true,
    };
  });

  app.post('/api/projects/:projectId/sessions/:sessionId/mcp/:serverId/enable', async ({ params }) => {
    mcpSessionOverlay.enable(params.sessionId, params.serverId);
    options.sseManager?.publishVolatile(MCP_EVENTS_PROJECT_ID, 'mcp.session.toggled', {
      sessionId: params.sessionId,
      serverId: params.serverId,
      disabled: false,
    });

    return {
      ok: true,
      serverId: params.serverId,
      sessionId: params.sessionId,
      disabled: false,
    };
  });

  // --- Tools ---

  app.get('/api/mcp/servers/:id/tools', async ({ params }) => {
    const tools = await mcpManager.listTools(params.id);
    return { ok: true, data: tools };
  });

  // --- Pin / Unpin ---

  app.post('/api/mcp/servers/:id/pin', async ({ params, body, set }) => {
    const parsed = PinToolSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { ok: false, error: 'Invalid request', details: parsed.error.issues };
    }

    const config = await readConfigFile(configPath);
    if (!config) {
      set.status = 404;
      return { ok: false, error: 'No config file found' };
    }

    const serverIndex = config.mcp.findIndex((s) => s.id === params.id);
    if (serverIndex === -1) {
      set.status = 404;
      return { ok: false, error: `MCP server "${params.id}" not found` };
    }

    const server = config.mcp[serverIndex];
    const currentPinned = server.pinnedTools ?? [];

    let updatedPinned: string[];
    if (parsed.data.pinned) {
      if (!currentPinned.includes(parsed.data.toolName)) {
        updatedPinned = [...currentPinned, parsed.data.toolName];
      } else {
        updatedPinned = currentPinned;
      }
    } else {
      updatedPinned = currentPinned.filter((t) => t !== parsed.data.toolName);
    }

    config.mcp[serverIndex] = { ...server, pinnedTools: updatedPinned };
    await writeConfigFile(configPath,config);

    return { ok: true, data: { id: params.id, pinnedTools: updatedPinned } };
  });

  // --- Registry ---

  app.get('/api/mcp/registry', async ({ query, set }) => {
    const sourceParam = query?.source ?? 'all';
    const sourceParse = RegistrySourceSchema.safeParse(sourceParam);
    if (!sourceParse.success) {
      set.status = 400;
      return { ok: false, error: `Invalid source. Must be one of: anthropic, smithery, bundled, all` };
    }

    const source = sourceParse.data;
    const page = query?.page ? Number(query.page) : undefined;
    const searchQuery = query?.query as string | undefined;

    if (source === 'bundled') {
      let entries = getBundledRegistry();
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        entries = entries.filter(
          (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
        );
      }
      return { ok: true, data: { entries, hasMore: false } };
    }

    if (source === 'anthropic') {
      try {
        let entries = await fetchAnthropicRegistry();
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          entries = entries.filter(
            (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
          );
        }
        return { ok: true, data: { entries, hasMore: false } };
      } catch (err) {
        console.warn('[elefant] Anthropic registry fetch failed:', err);
        return { ok: true, data: { entries: [], hasMore: false, error: 'Registry unavailable' } };
      }
    }

    if (source === 'smithery') {
      const result = await fetchSmitheryRegistry({
        page: page ?? 1,
        pageSize: 50,
        query: searchQuery,
      });
      return { ok: true, data: result };
    }

    // source === 'all'
    const [anthropic, smithery, bundled] = await Promise.all([
      fetchAnthropicRegistry(),
      fetchSmitheryRegistry({ page: page ?? 1, pageSize: 50, query: searchQuery }),
      Promise.resolve(getBundledRegistry()),
    ]);

    return {
      ok: true,
      data: {
        anthropic,
        smithery: smithery.entries,
        bundled,
        hasMore: smithery.hasMore,
      },
    };
  });

  app.post('/api/mcp/registry/refresh', async () => {
    invalidateAnthropicCache();
    void prefetchAnthropicRegistry();
    return { ok: true, data: { refreshed: true } };
  });

  return app;
}
