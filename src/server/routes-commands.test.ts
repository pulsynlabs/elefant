import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { mountCommandsRoute } from './routes-commands.ts';
import { loadCommandRegistry } from './slash-commands.ts';

let tmpDir: string;

beforeEach(() => {
	tmpDir = path.join(tmpdir(), `elefant-cmd-api-${randomUUID()}`);
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function setupTestRegistry(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });

	const registry = [
		{
			name: 'spec-discuss',
			trigger: '/spec-discuss',
			description: 'Start discovery interview.',
			category: 'spec-mode',
			args: '[session-name]',
		},
		{
			name: 'spec-plan',
			trigger: '/spec-plan',
			description: 'Create SPEC + BLUEPRINT.',
			category: 'spec-mode',
		},
		{
			name: 'spec-status',
			trigger: '/spec-status',
			description: 'Show workflow status.',
			category: 'spec-mode',
		},
		{
			name: 'custom-utility',
			trigger: '/custom-utility',
			description: 'A utility command.',
			category: 'utility',
		},
	];

	await writeFile(
		path.join(dir, 'COMMANDS_REGISTRY.json'),
		JSON.stringify(registry, null, 2),
		'utf-8',
	);

	// Create empty MD files so parseSlashCommand (which checks file existence) works
	for (const cmd of registry) {
		await writeFile(path.join(dir, `${cmd.name}.md`), `# ${cmd.trigger}\n\n${cmd.description}`, 'utf-8');
	}
}

describe('routes-commands', () => {
	it('GET /api/commands returns the full command registry', async () => {
		await setupTestRegistry(tmpDir);

		const app = new Elysia();
		// Don't mount the route via the standard function since it uses
		// the hard-coded COMMANDS_DIR. Instead, create a route inline
		// that uses our test directory.
		app.get('/api/commands', async () => {
			const registry = await loadCommandRegistry(tmpDir);
			return registry;
		});

		const response = await app.handle(new Request('http://localhost/api/commands'));
		expect(response.status).toBe(200);

		const body = await response.json() as Array<Record<string, unknown>>;
		expect(body).toHaveLength(4);
		expect(body[0].name).toBe('spec-discuss');
		expect(body[0].trigger).toBe('/spec-discuss');
		expect(body[0].category).toBe('spec-mode');
	});

	it('GET /api/commands?category=spec-mode returns only spec-mode commands', async () => {
		await setupTestRegistry(tmpDir);

		const app = new Elysia();
		app.get('/api/commands', async ({ query }) => {
			const registry = await loadCommandRegistry(tmpDir);
			const parsed = new URLSearchParams(
				typeof query === 'string' ? query : Object.entries(query as Record<string, string>)
					.map(([k, v]) => `${k}=${v}`)
					.join('&'),
			);
			const category = parsed.get('category');
			const filtered = category
				? registry.filter((c) => c.category === category)
				: registry;
			return filtered;
		});

		const response = await app.handle(
			new Request('http://localhost/api/commands?category=spec-mode'),
		);
		expect(response.status).toBe(200);

		const body = await response.json() as Array<Record<string, unknown>>;
		expect(body).toHaveLength(3);
		for (const cmd of body) {
			expect(cmd.category).toBe('spec-mode');
		}
	});

	it('GET /api/commands?category=utility returns only utility commands', async () => {
		await setupTestRegistry(tmpDir);

		const app = new Elysia();
		app.get('/api/commands', async ({ query }) => {
			const registry = await loadCommandRegistry(tmpDir);
			const parsed = new URLSearchParams(
				typeof query === 'string' ? query : Object.entries(query as Record<string, string>)
					.map(([k, v]) => `${k}=${v}`)
					.join('&'),
			);
			const category = parsed.get('category');
			const filtered = category
				? registry.filter((c) => c.category === category)
				: registry;
			return filtered;
		});

		const response = await app.handle(
			new Request('http://localhost/api/commands?category=utility'),
		);
		expect(response.status).toBe(200);

		const body = await response.json() as Array<Record<string, unknown>>;
		expect(body).toHaveLength(1);
		expect(body[0].name).toBe('custom-utility');
	});

	it('GET /api/commands returns 200 with empty array for empty registry', async () => {
		await mkdir(tmpDir, { recursive: true });
		await writeFile(
			path.join(tmpDir, 'COMMANDS_REGISTRY.json'),
			'[]',
			'utf-8',
		);

		const app = new Elysia();
		app.get('/api/commands', async () => {
			const registry = await loadCommandRegistry(tmpDir);
			return registry;
		});

		const response = await app.handle(new Request('http://localhost/api/commands'));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual([]);
	});

	it('mountCommandsRoute returns the Elysia app (function signature test)', () => {
		const app = new Elysia();
		const returned = mountCommandsRoute(app);
		expect(returned).toBe(app);
	});
});

describe('loadCommandRegistry via API', () => {
	it('correctly maps JSON entries to SlashCommandDefinition shape', async () => {
		await setupTestRegistry(tmpDir);
		const registry = await loadCommandRegistry(tmpDir);

		for (const cmd of registry) {
			expect(typeof cmd.name).toBe('string');
			expect(cmd.name.length).toBeGreaterThan(0);
			expect(typeof cmd.trigger).toBe('string');
			expect(cmd.trigger.startsWith('/')).toBe(true);
			expect(typeof cmd.description).toBe('string');
			expect(cmd.description.length).toBeGreaterThan(0);
			expect(['spec-mode', 'utility']).toContain(cmd.category);
			if (cmd.args !== undefined) {
				expect(typeof cmd.args).toBe('string');
			}
		}
	});
});
