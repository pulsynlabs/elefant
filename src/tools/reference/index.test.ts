/**
 * Reference tool unit tests — list, load, multi-load, and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { referenceTool, createReferenceTool } from './index.js';
import type { ReferenceParams } from './types.js';
import type { ToolDefinition } from '../../types/tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeProjectRef(
	projectDir: string,
	name: string,
	content: string,
): string {
	const refDir = join(projectDir, '.elefant', 'references');
	mkdirSync(refDir, { recursive: true });
	const path = join(refDir, `${name}.md`);
	writeFileSync(path, content, 'utf-8');
	return path;
}

function makeTempDir(): string {
	return join(
		tmpdir(),
		`elefant-ref-tool-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
}

/**
 * Call the tool executor with a fully-qualified params object.
 */
async function executeRef(
	params: ReferenceParams,
	tool: ToolDefinition<ReferenceParams, string> = referenceTool,
) {
	return tool.execute(params);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('referenceTool validation', () => {
	it('returns VALIDATION_ERROR when no name, names, or list provided', async () => {
		const result = await executeRef({});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.message).toBe(
				'Provide name, names, or list: true',
			);
		}
	});

	it('returns VALIDATION_ERROR when names is an empty array', async () => {
		const result = await executeRef({ names: [] });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
		}
	});
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('referenceTool list action', () => {
	let projectDir: string;
	let homeDir: string;

	beforeEach(() => {
		projectDir = makeTempDir();
		homeDir = makeTempDir();
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
	});

	afterEach(() => {
		try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
		try { rmSync(homeDir, { recursive: true, force: true }); } catch {}
	});

	it('returns formatted list including builtin refs when project/user are empty', async () => {
		const result = await executeRef({
			list: true,
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			// The seeded handoff-format.md should appear
			expect(result.data).toContain('handoff-format');
			expect(result.data).toContain('[builtin]');
			// Format should be `name [source]: description`
			expect(result.data).toMatch(/^[\w-]+ \[(project|user|builtin)\]: .+$/m);
		}
	});

	it('includes project-level refs in the formatted list', async () => {
		writeProjectRef(projectDir, 'custom-ref', '# Custom Reference');

		const result = await executeRef({
			list: true,
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('custom-ref');
			// Builtin refs should still be present
			expect(result.data).toContain('handoff-format');
		}
	});

	it('project ref shadows builtin ref with same name', async () => {
		// handoff-format exists in builtin; create a project-level shadow
		writeProjectRef(
			projectDir,
			'handoff-format',
			'---\ndescription: Project handoff override\n---\n\n# Project\n',
		);

		const result = await executeRef({
			list: true,
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			// Should show the project source, not builtin
			const lines = result.data.split('\n');
			const handoffLine = lines.find((l) => l.startsWith('handoff-format'));
			expect(handoffLine).toBeDefined();
			expect(handoffLine).toContain('[project]');
			expect(handoffLine).not.toContain('[builtin]');
		}
	});

	// -- Tag filtering ----------------------------------------------------

	it('displays tags for refs with valid frontmatter', async () => {
		// The builtin handoff-format.md has tags: orchestrator, executor, format
		const result = await executeRef({
			list: true,
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('handoff-format');
			expect(result.data).toContain('[orchestrator, executor, format]');
		}
	});

	it('filters by single tag', async () => {
		writeProjectRef(
			projectDir,
			'git-workflow',
			'---\nid: git-workflow\ntitle: Git Workflow\ndescription: Git workflow conventions.\ntags:\n  - git\n  - workflow\n---\n\n# Git\n',
		);

		const result = await executeRef({
			list: true,
			tag: 'git',
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('git-workflow');
			// Builtin handoff-format has orchestrator, executor, format — not "git"
			expect(result.data).not.toContain('handoff-format');
		}
	});

	it('filters by multiple tags (OR logic)', async () => {
		writeProjectRef(
			projectDir,
			'ref-a',
			'---\nid: ref-a\ntitle: Ref A\ndescription: First reference.\ntags:\n  - testing\n---\n\n# A\n',
		);
		writeProjectRef(
			projectDir,
			'ref-b',
			'---\nid: ref-b\ntitle: Ref B\ndescription: Second reference.\ntags:\n  - review\n---\n\n# B\n',
		);

		const result = await executeRef({
			list: true,
			tags: ['testing', 'review'],
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('ref-a');
			expect(result.data).toContain('ref-b');
			// Builtin should not match these tags
			expect(result.data).not.toContain('handoff-format');
		}
	});

	it('combines tag and tags params (treated as OR set)', async () => {
		writeProjectRef(
			projectDir,
			'ref-x',
			'---\nid: ref-x\ntitle: Ref X\ndescription: X marks the spot.\ntags:\n  - alpha\n---\n\n# X\n',
		);
		writeProjectRef(
			projectDir,
			'ref-y',
			'---\nid: ref-y\ntitle: Ref Y\ndescription: Y follows X.\ntags:\n  - beta\n---\n\n# Y\n',
		);

		const result = await executeRef({
			list: true,
			tag: 'alpha',
			tags: ['beta'],
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('ref-x');
			expect(result.data).toContain('ref-y');
		}
	});

	it('returns clear message when no refs match tag', async () => {
		const result = await executeRef({
			list: true,
			tag: 'nonexistent',
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toBe('No references match tag(s): nonexistent');
		}
	});

	it('returns clear message when no refs match multiple tags', async () => {
		const result = await executeRef({
			list: true,
			tags: ['ghost', 'phantom'],
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toBe('No references match tag(s): ghost, phantom');
		}
	});

	it('returns all refs when no tag filter is applied', async () => {
		writeProjectRef(
			projectDir,
			'tagged-ref',
			'---\nid: tagged-ref\ntitle: Tagged Ref\ndescription: A tagged ref.\ntags:\n  - special\n---\n\n# Special\n',
		);

		const result = await executeRef({
			list: true,
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('handoff-format'); // builtin
			expect(result.data).toContain('tagged-ref');    // project
		}
	});

	it('refs without frontmatter are excluded by tag filter', async () => {
		writeProjectRef(projectDir, 'no-fm', '# No Frontmatter\n');

		const result = await executeRef({
			list: true,
			tag: 'anything',
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).not.toContain('no-fm');
		}
	});
});

// ---------------------------------------------------------------------------
// Load by name
// ---------------------------------------------------------------------------

describe('referenceTool load by name', () => {
	let projectDir: string;
	let homeDir: string;

	beforeEach(() => {
		projectDir = makeTempDir();
		homeDir = makeTempDir();
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
	});

	afterEach(() => {
		try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
		try { rmSync(homeDir, { recursive: true, force: true }); } catch {}
	});

	it('returns content with header when reference exists (builtin)', async () => {
		const result = await executeRef({
			name: 'handoff-format',
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('# Reference: handoff-format');
			expect(result.data).toContain('**Source:** builtin');
			expect(result.data).toContain('## Overview');
		}
	});

	it('returns content with header when reference exists (project)', async () => {
		writeProjectRef(projectDir, 'my-protocol', '# My Protocol\n\nSome content.\n');

		const result = await executeRef({
			name: 'my-protocol',
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('# Reference: my-protocol');
			expect(result.data).toContain('**Source:** project');
			expect(result.data).toContain('# My Protocol');
		}
	});

	it('returns FILE_NOT_FOUND when reference does not exist in any tier', async () => {
		const result = await executeRef({
			name: 'nonexistent-ref-xyz',
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('FILE_NOT_FOUND');
			expect(result.error.message).toBe(
				'Reference not found: nonexistent-ref-xyz',
			);
		}
	});

	it('project ref takes priority over builtin with same name', async () => {
		writeProjectRef(projectDir, 'handoff-format', '---\ndescription: My override\n---\n\n# Project Override Content\n');

		const result = await executeRef({
			name: 'handoff-format',
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('**Source:** project');
			expect(result.data).toContain('# Project Override Content');
		}
	});
});

// ---------------------------------------------------------------------------
// Multi-load (names[])
// ---------------------------------------------------------------------------

describe('referenceTool multi-load (names[])', () => {
	let projectDir: string;
	let homeDir: string;

	beforeEach(() => {
		projectDir = makeTempDir();
		homeDir = makeTempDir();
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
	});

	afterEach(() => {
		try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
		try { rmSync(homeDir, { recursive: true, force: true }); } catch {}
	});

	it('returns concatenated content with separators when all found', async () => {
		writeProjectRef(projectDir, 'ref-a', '# Ref A Content\n');
		writeProjectRef(projectDir, 'ref-b', '# Ref B Content\n');

		const result = await executeRef({
			names: ['ref-a', 'ref-b'],
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('# Reference: ref-a');
			expect(result.data).toContain('# Ref A Content');
			expect(result.data).toContain('---');
			expect(result.data).toContain('# Reference: ref-b');
			expect(result.data).toContain('# Ref B Content');
		}
	});

	it('includes "Not found" footer when some references are missing', async () => {
		writeProjectRef(projectDir, 'found-ref', '# Found\n');
		// 'missing-ref' does not exist

		const result = await executeRef({
			names: ['found-ref', 'missing-ref'],
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('# Reference: found-ref');
			expect(result.data).toContain('# Found');
			expect(result.data).toContain('_Not found: missing-ref_');
		}
	});

	it('returns FILE_NOT_FOUND when none of the names resolve', async () => {
		const result = await executeRef({
			names: ['ghost-a', 'ghost-b'],
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('FILE_NOT_FOUND');
			expect(result.error.message).toContain('ghost-a');
			expect(result.error.message).toContain('ghost-b');
		}
	});

	it('preserves input order in output', async () => {
		writeProjectRef(projectDir, 'first', '# First\n');
		writeProjectRef(projectDir, 'second', '# Second\n');
		writeProjectRef(projectDir, 'third', '# Third\n');

		const result = await executeRef({
			names: ['third', 'first', 'second'],
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			const thirdIdx = result.data.indexOf('# Reference: third');
			const firstIdx = result.data.indexOf('# Reference: first');
			const secondIdx = result.data.indexOf('# Reference: second');

			expect(thirdIdx).toBeLessThan(firstIdx);
			expect(firstIdx).toBeLessThan(secondIdx);
		}
	});

	it('combines project and builtin refs in a single call', async () => {
		// project ref
		writeProjectRef(projectDir, 'my-local', '# Local\n');
		// handoff-format is builtin

		const result = await executeRef({
			names: ['my-local', 'handoff-format'],
			cwd: projectDir,
			home: homeDir,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toContain('# Reference: my-local');
			expect(result.data).toContain('# Reference: handoff-format');
			expect(result.data).toContain('**Source:** project');
			expect(result.data).toContain('**Source:** builtin');
			expect(result.data).toContain('---');
		}
	});
});

// ---------------------------------------------------------------------------
// createReferenceTool
// ---------------------------------------------------------------------------

describe('createReferenceTool', () => {
	let projectDir: string;
	let homeDir: string;

	beforeEach(() => {
		projectDir = makeTempDir();
		homeDir = makeTempDir();
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
	});

	afterEach(() => {
		try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
		try { rmSync(homeDir, { recursive: true, force: true }); } catch {}
	});

	it('returns a tool with name "reference"', async () => {
		const tool = await createReferenceTool({
			cwd: projectDir,
			home: homeDir,
		});

		expect(tool.name).toBe('reference');
	});

	it('embeds the live reference catalog in the description', async () => {
		const tool = await createReferenceTool({
			cwd: projectDir,
			home: homeDir,
		});

		expect(tool.description).toContain('handoff-format');
		expect(tool.description).toContain('[builtin]');
		expect(tool.description).toContain('## Available References');
	});

	it('description includes examples of tool usage', async () => {
		const tool = await createReferenceTool({
			cwd: projectDir,
			home: homeDir,
		});

		expect(tool.description).toContain('reference({ name: "handoff-format" })');
		expect(tool.description).toContain('reference({ names:');
		expect(tool.description).toContain('reference({ list: true })');
	});

	it('execute function works the same as the static tool', async () => {
		const tool = await createReferenceTool({
			cwd: projectDir,
			home: homeDir,
		});

		const staticResult = await executeRef(
			{ name: 'handoff-format', cwd: projectDir, home: homeDir },
			referenceTool,
		);
		const createdResult = await executeRef(
			{ name: 'handoff-format', cwd: projectDir, home: homeDir },
			tool,
		);

		expect(createdResult.ok).toBe(staticResult.ok);
		if (createdResult.ok && staticResult.ok) {
			expect(createdResult.data).toBe(staticResult.data);
		}
	});
});
