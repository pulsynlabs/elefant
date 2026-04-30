import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from '../db/database.ts';
import { insertProject } from '../db/repo/projects.ts';
import { ConfigManager, defaultAgentProfiles } from '../config/index.ts';
import { Elysia } from 'elysia';
import type { ProviderRouter } from '../providers/router.ts';
import { createConfigRoutes } from './config-routes.ts';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createMockProviderRouter(): ProviderRouter {
	return {
		reload: () => undefined,
		listProviders: () => ['mock-provider'],
		getAdapter: () => ({ ok: false, error: { code: 'CONFIG_INVALID', message: 'unused' } }),
	} as unknown as ProviderRouter;
}

describe('config routes - agent profiles', () => {
	let tempDir: string;
	let projectPath: string;
	let projectId: string;
	let db: Database;
	let app: Elysia;
	let globalConfigPath: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'elefant-config-routes-'));
		projectPath = join(tempDir, 'project');
		mkdirSync(join(projectPath, '.elefant'), { recursive: true });
		globalConfigPath = join(tempDir, 'elefant.config.json');

		db = new Database(':memory:');
		projectId = crypto.randomUUID();
		insertProject(db, {
			id: projectId,
			name: 'Config Routes Project',
			path: projectPath,
		});

		const configManager = new ConfigManager({
			globalConfigPath,
			projectPathResolver: (id) => {
				const row = db.db.query('SELECT path FROM projects WHERE id = ?').get(id) as
					| { path: string }
					| null;

				if (!row) {
					return { ok: false as const, error: { code: 'FILE_NOT_FOUND' as const, message: 'Project not found' } };
				}

				return { ok: true as const, data: row.path };
			},
		});

		app = createConfigRoutes(new Elysia(), createMockProviderRouter(), configManager);
	});

	afterEach(() => {
		db.close();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it('GET /api/config/agents/executor returns merged profile values', async () => {
		writeFileSync(
			globalConfigPath,
			JSON.stringify({
				agents: {
					executor: {
						...defaultAgentProfiles.executor,
						limits: {
							...defaultAgentProfiles.executor.limits,
							maxIterations: 20,
						},
					},
				},
			}),
		);

		writeFileSync(
			join(projectPath, '.elefant', 'config.json'),
			JSON.stringify({
				agents: {
					executor: {
						...defaultAgentProfiles.executor,
						limits: {
							...defaultAgentProfiles.executor.limits,
							maxIterations: 7,
						},
					},
				},
			}),
		);

		const response = await app.handle(
			new Request(
				`http://localhost/api/config/agents/executor?projectId=${projectId}`,
			),
		);
		expect(response.status).toBe(200);

		const payload = (await response.json()) as {
			ok: boolean;
			data: {
				limits: { maxIterations: number };
				_sources: Record<string, string>;
			};
		};

		expect(payload.ok).toBe(true);
		expect(payload.data.limits.maxIterations).toBe(7);
		expect(payload.data._sources['limits.maxIterations']).toBe('project');
	});

	it('POST/PUT/DELETE profile CRUD writes project layer', async () => {
		const createResponse = await app.handle(
			new Request(`http://localhost/api/config/agents?projectId=${projectId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...defaultAgentProfiles.default,
					id: 'custom-agent',
					label: 'Custom Agent',
					kind: 'custom',
				}),
			}),
		);

		expect(createResponse.status).toBe(201);

		const updateResponse = await app.handle(
			new Request(`http://localhost/api/config/agents/custom-agent?projectId=${projectId}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					limits: {
						maxIterations: 2,
					},
				}),
			}),
		);

		expect(updateResponse.status).toBe(200);
		const updated = (await updateResponse.json()) as {
			ok: boolean;
			data: { limits: { maxIterations: number } };
		};
		expect(updated.ok).toBe(true);
		expect(updated.data.limits.maxIterations).toBe(2);

		const deleteResponse = await app.handle(
			new Request(`http://localhost/api/config/agents/custom-agent?projectId=${projectId}`, {
				method: 'DELETE',
			}),
		);
		expect(deleteResponse.status).toBe(200);

		const missingDeleteResponse = await app.handle(
			new Request(`http://localhost/api/config/agents/custom-agent?projectId=${projectId}`, {
				method: 'DELETE',
			}),
		);
		expect(missingDeleteResponse.status).toBe(404);
	});

	it('returns global default profile when projectId is omitted', async () => {
		// projectId is now optional — omitting it resolves against global defaults only
		const response = await app.handle(
			new Request('http://localhost/api/config/agents/executor'),
		);
		expect(response.status).toBe(200);

		const payload = (await response.json()) as {
			ok: boolean;
			data: { id: string };
		};

		expect(payload.ok).toBe(true);
		expect(payload.data.id).toBe('executor');
	});

	it('GET /api/config/agents returns the Spec Mode fleet with verifier fresh context', async () => {
		const response = await app.handle(new Request('http://localhost/api/config/agents'));
		expect(response.status).toBe(200);

		const payload = (await response.json()) as {
			ok: boolean;
			data: Record<string, { contextMode: string; promptFile: string | null }>;
		};

		const requiredAgents = [
			'orchestrator',
			'planner',
			'researcher',
			'explorer',
			'verifier',
			'debugger',
			'tester',
			'writer',
			'librarian',
			'executor-low',
			'executor-medium',
			'executor-high',
			'executor-frontend',
		];

		expect(payload.ok).toBe(true);
		for (const agentId of requiredAgents) {
			expect(payload.data[agentId]).toBeDefined();
			expect(payload.data[agentId]?.promptFile).toBe(`src/agents/prompts/${agentId}.md`);
		}
		expect(payload.data.verifier?.contextMode).toBe('none');
	});

	it('PATCH /api/config/agents/:agentId accepts extended agent config fields', async () => {
		const response = await app.handle(
			new Request(`http://localhost/api/config/agents/executor-high?projectId=${projectId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model: 'gpt-5.5-high',
					provider: 'openai',
					toolsAllowlist: ['read', 'bash'],
					permissions: { read: true, write: true, execute: true },
					contextMode: 'snapshot',
					promptFile: 'src/agents/prompts/executor-high.md',
					promptOverride: '# Override\n\n## Role\nCustom',
				}),
			}),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			ok: boolean;
			data: {
				model: string;
				provider: string;
				toolsAllowlist: string[];
				permissions: { read: boolean; write: boolean; execute: boolean };
				contextMode: string;
				promptOverride: string | null;
			};
		};

		expect(payload.ok).toBe(true);
		expect(payload.data.model).toBe('gpt-5.5-high');
		expect(payload.data.provider).toBe('openai');
		expect(payload.data.toolsAllowlist).toEqual(['read', 'bash']);
		expect(payload.data.permissions.execute).toBe(true);
		expect(payload.data.contextMode).toBe('snapshot');
		expect(payload.data.promptOverride).toContain('Override');
	});
});

describe('config routes - provider registry', () => {
	let app: Elysia;

	beforeEach(() => {
		app = createConfigRoutes(new Elysia(), createMockProviderRouter(), new ConfigManager({
			globalConfigPath: join(tmpdir(), 'elefant.config.json'),
			projectPathResolver: () => ({ ok: false as const, error: { code: 'FILE_NOT_FOUND' as const, message: '' } }),
		}));
	});

	it('GET /api/providers/registry returns 200 with providers array', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/providers/registry'),
		);
		expect(response.status).toBe(200);

		const payload = (await response.json()) as { providers: unknown[] };
		expect(Array.isArray(payload.providers)).toBe(true);
		expect(payload.providers.length).toBeGreaterThan(0);
	});

	it('GET /api/providers/registry returns at least 20 providers', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/providers/registry'),
		);
		expect(response.status).toBe(200);

		const payload = (await response.json()) as { providers: unknown[] };
		expect(payload.providers.length).toBeGreaterThanOrEqual(20);
	});
});
