import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../db/database.ts';
import { emit } from '../hooks/emit.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { StateManager } from '../state/manager.ts';
import {
	buildSpecModeBlock,
	buildStateBlock,
	createCompactionBlockTransform,
} from './blocks.ts';
import type { Message } from '../types/providers.ts';

/**
 * Integration tests for the compaction block injection pipeline.
 *
 * These tests verify that `createCompactionBlockTransform` correctly injects
 * the Spec Mode block OR the generic state block depending on whether an active
 * spec workflow exists in the database, and that de-duplication guards against
 * double injection.
 *
 * Coverage:
 * - Test A: Active spec workflow → ## SPEC MODE block injected
 * - Test B: No active spec workflow → ## 🔮 Workflow State block injected
 * - Test C: De-duplication prevents double injection of ## SPEC MODE
 * - Test D: Empty blocks array returns messages unchanged (contextMode:none guard
 *   is at daemon registration site in src/daemon/create.ts — verified by code inspection)
 */

function seedProject(db: Database, projectId: string, projectPath: string): void {
	db.db.run(
		'INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
		[projectId, projectId, projectPath, null, new Date().toISOString(), new Date().toISOString()],
	);
}

function seedActiveSpecWorkflow(
	db: Database,
	projectId: string,
	workflowId: string,
	phase: string,
	currentWave: number,
	totalWaves: number,
): void {
	// Insert directly into spec_workflows table to avoid async state manager overhead
	db.db.run(
		`INSERT INTO spec_workflows (
			id, project_id, workflow_id, mode, depth, phase, status,
			autopilot, lazy_autopilot, locked, acceptance_confirmed,
			interview_complete, interview_completed_at, current_wave, total_waves,
			is_active, last_activity, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			crypto.randomUUID(),
			projectId,
			workflowId,
			'standard',
			'deep',
			phase,
			'idle',
			0, // autopilot
			0, // lazy_autopilot
			0, // locked
			0, // acceptance_confirmed
			0, // interview_complete
			null, // interview_completed_at
			currentWave,
			totalWaves,
			1, // is_active = true
			new Date().toISOString(),
			new Date().toISOString(),
			new Date().toISOString(),
		],
	);
}

function syntheticMessages(count: number): Message[] {
	return Array.from({ length: count }, (_, i) => ({
		role: i % 2 === 0 ? 'user' : 'assistant',
		content: `message-${i}`,
	}));
}

async function emitTransform(
	blocks: Array<{ name: string; render: () => string }>,
	messages: Message[],
	budget = 10_000,
): Promise<Message[]> {
	const hooks = new HookRegistry();
	hooks.register(
		'system:transform',
		createCompactionBlockTransform({ blocks, budget }),
	);

	const result = await emit(hooks, 'system:transform', {
		messages,
		sessionId: 'session-1',
		conversationId: 'conv-1',
		state: null,
		budgets: { tokens: budget },
	});

	return result.messages;
}

describe('CompactionBlockTransform integration', () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Test A: Spec Mode subagent sees ## SPEC MODE block
	// ─────────────────────────────────────────────────────────────────────────────

	it('injects ## SPEC MODE block when an active spec workflow exists', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'elefant-integration-spec-mode-'));
		tempDirs.push(tempDir);
		mkdirSync(join(tempDir, '.elefant'), { recursive: true });

		const db = new Database(join(tempDir, '.elefant', 'db.sqlite'));
		const projectId = crypto.randomUUID();
		const workflowId = 'context-compaction';
		const phase = 'execute';
		const currentWave = 2;
		const totalWaves = 4;

		seedProject(db, projectId, tempDir);
		seedActiveSpecWorkflow(db, projectId, workflowId, phase, currentWave, totalWaves);

		// Verify the row was inserted correctly
		const row = db.db
			.query('SELECT workflow_id, phase, current_wave, total_waves, is_active FROM spec_workflows WHERE project_id = ? AND is_active = 1')
			.get(projectId) as { workflow_id: string; phase: string; current_wave: number; total_waves: number; is_active: number } | null;
		expect(row).not.toBeNull();
		expect(row!.workflow_id).toBe(workflowId);
		expect(row!.is_active).toBe(1);
		expect(row!.current_wave).toBe(currentWave);
		expect(row!.total_waves).toBe(totalWaves);

		// Build the spec mode block using the same logic as the daemon
		const specBlockContent = buildSpecModeBlock(db, projectId, workflowId);
		expect(specBlockContent.length).toBeGreaterThan(0);
		expect(specBlockContent).toContain('## SPEC MODE');

		// Build a BlockBuilder that mirrors the daemon's inline render function
		const compactionBlock = {
			name: 'compaction-context',
			render: () => buildSpecModeBlock(db, projectId, workflowId),
		};

		const inputMessages = syntheticMessages(5);
		const outputMessages = await emitTransform([compactionBlock], inputMessages);

		// Assert: first system message should be the spec mode block
		const firstSystemMessage = outputMessages.find((m) => m.role === 'system');
		expect(firstSystemMessage).toBeDefined();
		expect(firstSystemMessage!.content).toContain('## SPEC MODE');
		expect(firstSystemMessage!.content).toContain('RESUME FROM HERE');
		expect(firstSystemMessage!.content).toContain(phase);
		expect(firstSystemMessage!.content).toContain(`${currentWave}/${totalWaves}`);

		// Assert: original messages are preserved (after the injected blocks)
		const originalMessages = outputMessages.filter((m) => m.content.startsWith('message-'));
		expect(originalMessages.length).toBe(5);

		db.close();
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Test B: Quick Mode subagent sees ## 🔮 Workflow State block
	// ─────────────────────────────────────────────────────────────────────────────

	it('injects ## 🔮 Workflow State block when no active spec workflow exists', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'elefant-integration-quick-mode-'));
		tempDirs.push(tempDir);
		mkdirSync(join(tempDir, '.elefant'), { recursive: true });

		const db = new Database(join(tempDir, '.elefant', 'db.sqlite'));
		const projectId = crypto.randomUUID();

		seedProject(db, projectId, tempDir);

		// Verify no active spec workflow
		const row = db.db
			.query('SELECT workflow_id FROM spec_workflows WHERE project_id = ? AND is_active = 1')
			.get(projectId);
		expect(row).toBeNull();

		// Build state block using the state manager (mirrors daemon fallback path)
		const stateManager = new StateManager(tempDir, {
			id: projectId,
			name: projectId,
			path: tempDir,
		});

		const stateBlockContent = buildStateBlock(stateManager.getState());
		expect(stateBlockContent.length).toBeGreaterThan(0);
		expect(stateBlockContent).toContain('## 🔮 Workflow State');

		// BlockBuilder mirrors daemon fallback render path (buildStateBlock when no active spec)
		const compactionBlock = {
			name: 'compaction-context',
			render: () => buildStateBlock(stateManager.getState()),
		};

		const inputMessages = syntheticMessages(5);
		const outputMessages = await emitTransform([compactionBlock], inputMessages);

		// Assert: first system message should be the state block
		const firstSystemMessage = outputMessages.find((m) => m.role === 'system');
		expect(firstSystemMessage).toBeDefined();
		expect(firstSystemMessage!.content).toContain('## 🔮 Workflow State');
		expect(firstSystemMessage!.content).toContain('RESUME FROM HERE');

		// Assert: original messages are preserved
		const originalMessages = outputMessages.filter((m) => m.content.startsWith('message-'));
		expect(originalMessages.length).toBe(5);

		db.close();
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Test C: De-duplication prevents double injection of ## SPEC MODE
	// ─────────────────────────────────────────────────────────────────────────────

	it('does not inject a second ## SPEC MODE block when one already exists in input', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'elefant-integration-dedup-'));
		tempDirs.push(tempDir);
		mkdirSync(join(tempDir, '.elefant'), { recursive: true });

		const db = new Database(join(tempDir, '.elefant', 'db.sqlite'));
		const projectId = crypto.randomUUID();
		const workflowId = 'context-compaction';

		seedProject(db, projectId, tempDir);
		seedActiveSpecWorkflow(db, projectId, workflowId, 'execute', 2, 4);

		const compactionBlock = {
			name: 'compaction-context',
			render: () => buildSpecModeBlock(db, projectId, workflowId),
		};

		// Input already contains a ## SPEC MODE system message
		const existingSpecBlock = '## SPEC MODE — context-compaction\n> **RESUME FROM HERE:** Wave 2/4 in progress.';
		const inputMessages: Message[] = [
			{ role: 'system', content: existingSpecBlock },
			{ role: 'user', content: 'message-0' },
			{ role: 'assistant', content: 'message-1' },
		];

		const outputMessages = await emitTransform([compactionBlock], inputMessages);

		// Count how many messages start with ## SPEC MODE
		const specModeCount = outputMessages.filter(
			(m) => m.role === 'system' && m.content.includes('## SPEC MODE'),
		).length;

		// Assert: only the pre-existing one should be present (no double injection)
		expect(specModeCount).toBe(1);
		expect(outputMessages.length).toBe(inputMessages.length);

		db.close();
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Test D: Empty blocks array returns messages unchanged (contextMode:none guard)
	// ─────────────────────────────────────────────────────────────────────────────

	it('returns messages unchanged when blocks array is empty', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'elefant-integration-empty-blocks-'));
		tempDirs.push(tempDir);

		const inputMessages = syntheticMessages(3);

		// NOTE: contextMode:none is guarded at the daemon registration site in
		// src/daemon/create.ts (system:transform handler checks run.context_mode === 'none'
		// BEFORE calling compactionTransform). This is verified by code inspection:
		//
		//   hookRegistry.on('system:transform', (context) => {
		//     if (context.runId) {
		//       const run = db.db.query('SELECT context_mode FROM agent_runs ...').get(context.runId);
		//       if (run?.context_mode === 'none') {
		//         return { messages: context.messages };  // ← early return, no transform
		//       }
		//     }
		//     return compactionTransform(context);       // ← only reached if not 'none'
		//   }, { priority: 10 });
		//
		// The transform itself (createCompactionBlockTransform) has no knowledge of
		// contextMode — that logic lives entirely in the daemon wiring.
		// Here we verify the transform's own empty-blocks guard.

		const outputMessages = await emitTransform([], inputMessages);

		expect(outputMessages).toEqual(inputMessages);
		expect(outputMessages.length).toBe(inputMessages.length);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Additional: Multiple blocks are rendered in order and prepended correctly
	// ─────────────────────────────────────────────────────────────────────────────

	it('renders multiple blocks in order and prepends them after fixed system header', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'elefant-integration-multi-block-'));
		tempDirs.push(tempDir);

		const stateManager = new StateManager(tempDir, {
			id: crypto.randomUUID(),
			name: 'test',
			path: tempDir,
		});

		const blocks = [
			{ name: 'block-a', render: () => '## Block A\nContent A' },
			{ name: 'block-b', render: () => '## Block B\nContent B' },
		];

		const inputMessages: Message[] = [
			{ role: 'system', content: 'fixed-header' },
			{ role: 'user', content: 'task' },
		];

		const outputMessages = await emitTransform(blocks, inputMessages);

		// Fixed header stays first, then injected blocks, then original messages
		expect(outputMessages[0]).toEqual({ role: 'system', content: 'fixed-header' });
		expect(outputMessages[1]).toEqual({ role: 'system', content: '## Block A\nContent A' });
		expect(outputMessages[2]).toEqual({ role: 'system', content: '## Block B\nContent B' });
		expect(outputMessages[3]).toEqual({ role: 'user', content: 'task' });
	});
});
