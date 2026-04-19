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

	it('returns validation error envelope when projectId is missing', async () => {
		const response = await app.handle(
			new Request('http://localhost/api/config/agents/executor'),
		);
		expect(response.status).toBe(400);

		const payload = (await response.json()) as {
			ok: boolean;
			error: { code: string; message: string };
		};

		expect(payload.ok).toBe(false);
		expect(payload.error.code).toBe('VALIDATION_ERROR');
	});
});
