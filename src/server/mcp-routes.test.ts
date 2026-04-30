import { afterEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMcpRoutes } from './mcp-routes.ts';
import type { MCPManager } from '../mcp/manager.ts';
import type { MCPServerStatus, ToolWithMeta } from '../mcp/types.ts';
import { invalidateAnthropicCache } from '../mcp/registry/anthropic.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type MockTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

function createMockMCPManager(overrides?: Partial<MCPManager>): MCPManager {
  const statusMap = new Map<string, MCPServerStatus>();
  const toolsMap = new Map<string, MockTool[]>();

  return {
    getStatus: (id: string) => statusMap.get(id),
    getPinnedTools: (_id: string) => [],
    connect: async (id: string) => { statusMap.set(id, 'connected'); },
    disconnect: async (id: string) => { statusMap.set(id, 'disabled'); },
    reconnect: async (id: string) => {
      statusMap.set(id, 'connecting');
      await new Promise((r) => setTimeout(r, 1));
      statusMap.set(id, 'connected');
    },
    listTools: async (id: string) => toolsMap.get(id) ?? [],
    getTimeout: (_id: string) => 30000,
    searchTools: () => [],
    getServerForTool: () => undefined,
    listAllTools: () => [],
    callTool: async () => { throw new Error('not implemented'); },
    init: async () => {},
    shutdown: async () => {},
    ...overrides,
  } as unknown as MCPManager;
}

const tempDirs: string[] = [];

function setupApp(configData: Record<string, unknown> = {}, mcpOverrides?: Partial<MCPManager>): Elysia {
  const dir = mkdtempSync(join(tmpdir(), 'elefant-mcp-routes-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'elefant.config.json');

  // Write initial config
  writeFileSync(configPath, JSON.stringify(
    { mcp: [], providers: [], ...configData },
    null,
    2,
  ) + '\n');

  const app = createMcpRoutes(
    new Elysia(),
    createMockMCPManager(mcpOverrides),
    { configPath },
  );

  return app;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  invalidateAnthropicCache();
  delete process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC;
});

describe('MCP routes', () => {
  describe('GET /api/mcp/servers', () => {
    it('returns empty array when no servers configured', async () => {
      const app = setupApp();

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers'),
      );
      const body = await response.json() as { ok: boolean; data: unknown[] };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns expected shape with configured servers', async () => {
      const serverId = crypto.randomUUID();
      const config = {
        mcp: [
          {
            id: serverId,
            name: 'test-server',
            transport: 'stdio',
            command: ['echo', 'hello'],
            enabled: true,
          },
        ],
      };

      const app = setupApp(config, {
        getStatus: () => 'connected' as MCPServerStatus,
        listAllTools: () => [
          { serverId, tool: { name: 'tool-a' } },
          { serverId, tool: { name: 'tool-b' } },
        ] as ToolWithMeta[],
      });

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers'),
      );
      const body = await response.json() as {
        ok: boolean;
        data: Array<{
          id: string;
          name: string;
          transport: string;
          status: string;
          toolCount: number;
          pinnedTools: string[];
        }>;
      };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe(serverId);
      expect(body.data[0]?.name).toBe('test-server');
      expect(body.data[0]?.transport).toBe('stdio');
      expect(body.data[0]?.status).toBe('connected');
      expect(body.data[0]?.toolCount).toBe(2);
      expect(body.data[0]?.pinnedTools).toEqual([]);
    });
  });

  describe('GET /api/mcp/servers/:id', () => {
    it('returns correct server data for a known id', async () => {
      const serverId = crypto.randomUUID();
      const config = {
        mcp: [
          {
            id: serverId,
            name: 'single-server',
            transport: 'stdio',
            command: ['echo', 'hello'],
            enabled: true,
            pinnedTools: ['tool-a'],
          },
        ],
      };

      const app = setupApp(config, {
        getStatus: () => 'connected' as MCPServerStatus,
        listAllTools: () => [
          { serverId, tool: { name: 'tool-a' } },
          { serverId, tool: { name: 'tool-b' } },
          { serverId, tool: { name: 'tool-c' } },
        ] as ToolWithMeta[],
      });

      const response = await app.handle(
        new Request(`http://localhost/api/mcp/servers/${serverId}`),
      );
      const body = await response.json() as {
        ok: boolean;
        data: {
          id: string;
          name: string;
          transport: string;
          enabled: boolean;
          status: string;
          toolCount: number;
          pinnedTools: string[];
        };
      };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe(serverId);
      expect(body.data.name).toBe('single-server');
      expect(body.data.transport).toBe('stdio');
      expect(body.data.enabled).toBe(true);
      expect(body.data.status).toBe('connected');
      expect(body.data.toolCount).toBe(3);
      expect(body.data.pinnedTools).toEqual(['tool-a']);
    });

    it('returns 404 for an unknown id', async () => {
      const app = setupApp({
        mcp: [
          {
            id: crypto.randomUUID(),
            name: 'known-server',
            transport: 'stdio',
            command: ['echo', 'known'],
          },
        ],
      });

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers/missing-server'),
      );
      const body = await response.json() as { ok: boolean; error: string };

      expect(response.status).toBe(404);
      expect(body.ok).toBe(false);
      expect(body.error).toBe('Server not found');
    });
  });

  describe('GET /api/mcp/registry', () => {
    it('source=bundled returns at least 30 entries', async () => {
      const app = setupApp();

      const response = await app.handle(
        new Request('http://localhost/api/mcp/registry?source=bundled'),
      );
      const body = await response.json() as {
        ok: boolean;
        data: { entries: unknown[]; hasMore: boolean };
      };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.entries.length).toBeGreaterThanOrEqual(30);
      expect(body.data.hasMore).toBe(false);
    });

    it('source=all returns sectioned response', async () => {
      // Mock the anthropic fetch
      const app = setupApp();

      // ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC to avoid real network calls
      process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC = '1';

      const response = await app.handle(
        new Request('http://localhost/api/mcp/registry?source=all'),
      );
      const body = await response.json() as {
        ok: boolean;
        data: { anthropic: unknown[]; smithery: unknown[]; bundled: unknown[]; hasMore: boolean };
      };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.anthropic)).toBe(true);
      expect(Array.isArray(body.data.smithery)).toBe(true);
      expect(Array.isArray(body.data.bundled)).toBe(true);
      expect(body.data.bundled.length).toBeGreaterThanOrEqual(30);
    });

    it('returns 400 for invalid source', async () => {
      const app = setupApp();

      const response = await app.handle(
        new Request('http://localhost/api/mcp/registry?source=invalid'),
      );
      const body = await response.json() as { ok: boolean; error: string };

      expect(response.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Invalid source');
    });

    it('supports search query on bundled source', async () => {
      const app = setupApp();

      const response = await app.handle(
        new Request('http://localhost/api/mcp/registry?source=bundled&query=filesystem'),
      );
      const body = await response.json() as {
        ok: boolean;
        data: { entries: Array<{ name: string }> };
      };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.entries.length).toBeGreaterThan(0);
      for (const entry of body.data.entries) {
        const haystack = `${entry.name}`.toLowerCase();
        expect(haystack).toContain('filesystem');
      }
    });
  });

  describe('POST /api/mcp/registry/refresh', () => {
    it('clears Anthropic cache', async () => {
      process.env.ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC = '1';
      const app = setupApp();

      const response = await app.handle(
        new Request('http://localhost/api/mcp/registry/refresh', { method: 'POST' }),
      );
      const body = await response.json() as { ok: boolean; data: { refreshed: boolean } };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.refreshed).toBe(true);
    });
  });

  describe('POST /api/mcp/servers', () => {
    it('validates schema and rejects invalid config', async () => {
      const app = setupApp();

      // Missing required fields
      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );
      const body = await response.json() as { ok: boolean; error: string };

      expect(response.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Invalid MCP server configuration');
    });

    it('rejects missing required transport field', async () => {
      const app = setupApp();

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            name: 'incomplete-server',
          }),
        }),
      );

      expect(response.status).toBe(400);
    });

    it('rejects duplicate server name', async () => {
      const serverId = crypto.randomUUID();
      const app = setupApp({
        mcp: [
          {
            id: serverId,
            name: 'existing-server',
            transport: 'stdio',
            command: ['echo', 'hello'],
          },
        ],
      });

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            name: 'existing-server',
            transport: 'stdio',
            command: ['echo', 'hello'],
          }),
        }),
      );
      const body = await response.json() as { ok: boolean; error: string };

      expect(response.status).toBe(409);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('already exists');
    });
  });

  describe('PUT /api/mcp/servers/:id', () => {
    it('updates an existing server and reconnects it', async () => {
      const serverId = crypto.randomUUID();
      let reconnectedId: string | undefined;
      const app = setupApp({
        mcp: [
          {
            id: serverId,
            name: 'old-server',
            transport: 'stdio',
            command: ['echo', 'old'],
          },
        ],
      }, {
        reconnect: async (id: string) => { reconnectedId = id; },
      });

      const response = await app.handle(
        new Request(`http://localhost/api/mcp/servers/${serverId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: serverId,
            name: 'new-server',
            transport: 'stdio',
            command: ['echo', 'new'],
          }),
        }),
      );
      const body = await response.json() as { ok: boolean; data: { name: string; status: string } };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.name).toBe('new-server');
      expect(body.data.status).toBe('connecting');
      expect(reconnectedId).toBe(serverId);
    });
  });

  describe('DELETE /api/mcp/servers/:id', () => {
    it('deletes a configured server and disconnects it', async () => {
      const serverId = crypto.randomUUID();
      let disconnectedId: string | undefined;
      const app = setupApp({
        mcp: [
          {
            id: serverId,
            name: 'delete-server',
            transport: 'stdio',
            command: ['echo', 'delete'],
          },
        ],
      }, {
        disconnect: async (id: string) => { disconnectedId = id; },
      });

      const response = await app.handle(
        new Request(`http://localhost/api/mcp/servers/${serverId}`, { method: 'DELETE' }),
      );
      const body = await response.json() as { ok: boolean; data: { deleted: string } };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.deleted).toBe(serverId);
      expect(disconnectedId).toBe(serverId);
    });

    it('returns 404 for an unknown id', async () => {
      const app = setupApp({
        mcp: [
          {
            id: crypto.randomUUID(),
            name: 'known-server',
            transport: 'stdio',
            command: ['echo', 'known'],
          },
        ],
      });

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers/missing-server', { method: 'DELETE' }),
      );
      const body = await response.json() as { ok: boolean; error: string };

      expect(response.status).toBe(404);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('not found');
    });
  });

  describe('POST /api/mcp/servers/:id/connect', () => {
    it('calls reconnect on MCP manager', async () => {
      let reconnectedId: string | undefined;
      const app = setupApp({}, {
        reconnect: async (id: string) => { reconnectedId = id; },
        getStatus: () => 'connected' as MCPServerStatus,
      });

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers/srv-1/connect', { method: 'POST' }),
      );
      const body = await response.json() as { ok: boolean; data: { id: string; status: string } };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(reconnectedId).toBe('srv-1');
      expect(body.data.status).toBe('connected');
    });
  });

  describe('POST /api/mcp/servers/:id/disconnect', () => {
    it('calls disconnect on MCP manager', async () => {
      let disconnectedId: string | undefined;
      const app = setupApp({}, {
        disconnect: async (id: string) => { disconnectedId = id; },
      });

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers/srv-1/disconnect', { method: 'POST' }),
      );
      const body = await response.json() as { ok: boolean; data: { id: string; status: string } };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(disconnectedId).toBe('srv-1');
      expect(body.data.status).toBe('disabled');
    });
  });

  describe('GET /api/mcp/servers/:id/tools', () => {
    it('returns tools list from MCP manager', async () => {
      const mockTools: MockTool[] = [
        { name: 'tool-one', inputSchema: { type: 'object' } },
        { name: 'tool-two', description: 'Does something', inputSchema: { type: 'object' } },
      ];

      const app = setupApp({}, {
        listTools: async () => mockTools as Tool[],
      });

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers/srv-1/tools'),
      );
      const body = await response.json() as { ok: boolean; data: MockTool[] };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual(mockTools);
    });
  });

  describe('POST /api/mcp/servers/:id/pin', () => {
    it('pins and unpins a tool in persisted config', async () => {
      const serverId = crypto.randomUUID();
      const app = setupApp({
        mcp: [
          {
            id: serverId,
            name: 'pin-server',
            transport: 'stdio',
            command: ['echo', 'pin'],
            pinnedTools: [],
          },
        ],
      });

      const pinResponse = await app.handle(
        new Request(`http://localhost/api/mcp/servers/${serverId}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolName: 'list_directory', pinned: true }),
        }),
      );
      const pinBody = await pinResponse.json() as { ok: boolean; data: { pinnedTools: string[] } };
      expect(pinResponse.status).toBe(200);
      expect(pinBody.data.pinnedTools).toEqual(['list_directory']);

      const unpinResponse = await app.handle(
        new Request(`http://localhost/api/mcp/servers/${serverId}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolName: 'list_directory', pinned: false }),
        }),
      );
      const unpinBody = await unpinResponse.json() as { ok: boolean; data: { pinnedTools: string[] } };
      expect(unpinResponse.status).toBe(200);
      expect(unpinBody.data.pinnedTools).toEqual([]);
    });

    it('rejects invalid pin payloads', async () => {
      const app = setupApp();

      const response = await app.handle(
        new Request('http://localhost/api/mcp/servers/srv-1/pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolName: '', pinned: true }),
        }),
      );

      expect(response.status).toBe(400);
    });
  });
});
