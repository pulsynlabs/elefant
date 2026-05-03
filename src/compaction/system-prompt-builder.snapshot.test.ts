import { afterAll, describe, expect, it } from 'bun:test';

import {
	buildSystemPrompt,
	type SystemPromptContext,
	type WorkflowPromptState,
} from './system-prompt-builder.ts';
import { estimateTokens } from './system-prompt/token-count.ts';
import { DEFAULT_COMMANDS } from './system-prompt/command-listing.ts';
import type { ToolDefinition } from '../types/tools.ts';
import type { SkillInfo } from '../tools/skill/resolver.ts';

// ---------------------------------------------------------------------------
// Realistic mock ToolRegistry — reflects the CURRENT set of tools registered
// by createToolRegistryForRun() (src/tools/registry.ts), including all
// wf_* workflow tools, interactive tools, filesystem tools, and misc.
// ---------------------------------------------------------------------------

function tool(name: string, description: string, category?: string): ToolDefinition {
	return {
		name,
		description,
		parameters: {},
		execute: async () => ({ ok: true, data: 'ok' }),
		...(category ? { category } : {}),
	};
}

const mockRegistry: Pick<ToolRegistry, 'getAll'> = {
	getAll: (): ToolDefinition[] => [
		// ---- Workflow tools ----
		tool('wf_status', 'Read the active Spec Mode workflow status with an invariant payload shape.'),
		tool('wf_state', 'Read or mutate Spec Mode workflow state through StateManager operations.'),
		tool('wf_workflow', 'List, create, or activate Spec Mode workflows for a project.'),
		tool('wf_requirements', 'Read, write, or extract sections from the REQUIREMENTS document.'),
		tool('wf_spec', 'Read, write, lock, or amend the locked SPEC contract.'),
		tool('wf_blueprint', 'Read, write, or query wave sections from the BLUEPRINT document.'),
		tool('wf_chronicle', 'Append to or read from the Spec Mode CHRONICLE log.'),
		tool('wf_adl', 'Append to or read from the Spec Mode architectural decision log.'),
		tool('wf_checkpoint', 'Save, load, or list workflow checkpoints stored in CHRONICLE entries.'),
		// ---- Interactive tools (2) ----
		tool('question', 'Ask the user a structured question with options. Returns the selected option label(s).'),
		tool('slider', 'Present a slider to the user to collect a numeric value. The user adjusts the slider and submits a value.'),

		// ---- Filesystem tools (8) ----
		tool('apply_patch', 'Apply a multi-file patch with Add/Update/Delete/Move operations atomically.'),
		tool('bash', 'Execute shell commands. Uses persistent session by default (maintains cwd/env).'),
		tool('edit', 'Exact string replacement within a file. Fails if oldString not found or ambiguous.'),
		tool('glob', 'Pattern-based file discovery. Results sorted by modification time (newest first).'),
		tool('grep', 'Search file contents using regex. Returns file:line:content matches.'),
		tool('read', 'Read file contents. For directories, lists entries.'),
		tool('write', 'Write full file content. Creates parent directories if needed. Overwrites existing files.'),

		// ---- Provider tools (2) ----
		tool('webfetch', 'Fetch web content from a URL and return it as cleaned text or markdown.'),
		tool('websearch', 'Search the web using Brave Search. Requires BRAVE_API_KEY environment variable.'),

		// ---- Other tools (8) ----
		tool('agent_session_search', 'Search the persisted message history of a completed child agent run.'),
		tool('lsp', 'Experimental code intelligence via Language Server Protocol.'),
		tool('skill', 'Load a SKILL.md file by name, or list all available skills.'),
		tool('task', 'Spawn a child agent run and block until it completes. Returns runId, status, result.'),
		tool('todowrite', 'Create or replace the full task list for the current conversation.'),
		tool('todoread', 'Read the current task list for the conversation.'),
		tool('tool_list', 'List all tools currently available to you at runtime, with descriptions and parameter signatures.'),
		// mcp_search_tools is included when MCP manager is available; include in full-set test
		tool('mcp_search_tools', 'Search MCP tools available from connected MCP servers.'),
	],
};

// For Quick Mode we drop workflow tools (they're gated to Spec Mode only)
const mockRegistryQuick: Pick<ToolRegistry, 'getAll'> = {
	getAll: (): ToolDefinition[] =>
		mockRegistry.getAll().filter((t) => !t.name.startsWith('wf_')),
};

// ---------------------------------------------------------------------------
// Shared test contexts
// ---------------------------------------------------------------------------

const specExecuteState: WorkflowPromptState = {
	phase: 'execute',
	currentWave: 3,
	totalWaves: 6,
};

const fixtureSkills: readonly SkillInfo[] = [
	{
		name: 'p5js',
		description: 'Production pipeline for interactive and generative visual art using p5.js',
		source: 'user' as const,
		path: '/home/user/.agents/skills/p5js/SKILL.md',
	},
];

function quickContext(): SystemPromptContext {
	return {
		toolRegistry: mockRegistryQuick,
		sessionMode: 'quick',
		commands: DEFAULT_COMMANDS,
	};
}

function specContext(workflowState?: WorkflowPromptState): SystemPromptContext {
	return {
		toolRegistry: mockRegistry, // full set for Spec Mode
		sessionMode: 'spec',
		workflowState,
		commands: DEFAULT_COMMANDS,
		skills: fixtureSkills,
	};
}

// ---------------------------------------------------------------------------
// Token budget assertions
// ---------------------------------------------------------------------------

describe('system-prompt token budget', () => {
	let quickTokens = 0;
	let specTokens = 0;

	it('Quick Mode baseline is ≤ 2000 tokens', () => {
		const prompt = buildSystemPrompt(quickContext());
		quickTokens = estimateTokens(prompt);
		console.log(`Quick Mode baseline: ${quickTokens} tokens`);

		expect(prompt).not.toContain('wf_');
		expect(quickTokens).toBeLessThanOrEqual(2000);
	});

	it('Spec Mode + active workflow is ≤ 3000 tokens', () => {
		const prompt = buildSystemPrompt(specContext(specExecuteState));
		specTokens = estimateTokens(prompt);
		console.log(`Spec Mode + active workflow: ${specTokens} tokens`);

		expect(prompt).toContain('wf_');
		expect(specTokens).toBeLessThanOrEqual(3000);
	});

	it('Spec Mode + no workflow is ≤ 3000 tokens', () => {
		const prompt = buildSystemPrompt(specContext());
		const tokens = estimateTokens(prompt);
		console.log(`Spec Mode (no workflow): ${tokens} tokens`);

		expect(tokens).toBeLessThanOrEqual(3000);
	});

	// Log token counts at the end so they're visible even when tests fail
	afterAll(() => {
		console.log(`\n=== MH5 TOKEN BUDGET REPORT ===`);
		console.log(`Quick Mode baseline: ${quickTokens} tokens (budget: 2000)`);
		console.log(`Spec Mode + execute/W3: ${specTokens} tokens (budget: 3000)`);
	});
});

// ---------------------------------------------------------------------------
// Structure snapshot test
// ---------------------------------------------------------------------------

describe('system-prompt structure snapshot', () => {
	it('Quick Mode prompt structure matches snapshot', () => {
		const prompt = buildSystemPrompt(quickContext());
		// Extract section headings for structural stability
		const sections = prompt.match(/^##+ .+$/gm) ?? [];
		expect(sections).toMatchSnapshot('quick-mode-sections');
	});

	it('Spec Mode prompt structure matches snapshot', () => {
		const prompt = buildSystemPrompt(specContext(specExecuteState));
		const sections = prompt.match(/^##+ .+$/gm) ?? [];
		expect(sections).toMatchSnapshot('spec-mode-sections');
	});

	it('contains all required section markers', () => {
		const prompt = buildSystemPrompt(specContext(specExecuteState));
		expect(prompt).toContain('## Identity');
		expect(prompt).toContain('## Available Tools');
		expect(prompt).toContain('## Available Skills');
		expect(prompt).toContain('## Workflow Mode: Spec');
		expect(prompt).toContain('## Slash Commands');
		expect(prompt).toContain('## Context Assembly');
	});

	it('includes available skills XML when fixture skills are provided', () => {
		const prompt = buildSystemPrompt(specContext(specExecuteState));

		expect(prompt).toContain('<available_skills>');
		expect(prompt).toContain('<name>p5js</name>');
	});

	it('omits available skills XML when skills are empty or undefined', () => {
		const withEmptySkills = buildSystemPrompt({
			...specContext(specExecuteState),
			skills: [],
		});
		const contextWithoutSkills: SystemPromptContext = {
			toolRegistry: mockRegistry,
			sessionMode: 'spec',
			workflowState: specExecuteState,
			commands: DEFAULT_COMMANDS,
		};
		const withUndefinedSkills = buildSystemPrompt(contextWithoutSkills);

		expect(withEmptySkills).not.toContain('<available_skills>');
		expect(withUndefinedSkills).not.toContain('<available_skills>');
	});

	it('Quick Mode omits workflow section', () => {
		const prompt = buildSystemPrompt(quickContext());
		expect(prompt).not.toContain('## Workflow Mode:');
	});

	it('tool inventory categorises tools correctly', () => {
		const prompt = buildSystemPrompt(quickContext());

		// Verify category headings exist for tools present
		expect(prompt).toContain('### Interactive');
		expect(prompt).toContain('### Filesystem');
		expect(prompt).toContain('### Provider');
		expect(prompt).toContain('### Other');

		// Quick Mode has no workflow tools in the tool inventory.
		// The "### Workflow" heading only appears inside the Available Tools
		// section — verify it is NOT present there by checking the tools block.
		const toolsBlock = prompt.split('## Slash Commands')[0];
		expect(toolsBlock).not.toContain('### Workflow');
	});

	it('command listing includes all 15 commands', () => {
		const prompt = buildSystemPrompt(quickContext());
		for (const cmd of DEFAULT_COMMANDS) {
			expect(prompt).toContain(cmd.trigger);
		}
	});
});
