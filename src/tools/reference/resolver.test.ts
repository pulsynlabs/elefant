/**
 * Reference resolver unit tests — 3-tier hierarchical resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	resolveReference,
	listReferences,
} from './resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeRef(dir: string, name: string, content: string): string {
	const refDir = join(dir, '.elefant', 'references');
	mkdirSync(refDir, { recursive: true });
	const path = join(refDir, `${name}.md`);
	writeFileSync(path, content, 'utf-8');
	return path;
}

function writeUserRef(home: string, name: string, content: string): string {
	const refDir = join(home, '.config', 'elefant', 'references');
	mkdirSync(refDir, { recursive: true });
	const path = join(refDir, `${name}.md`);
	writeFileSync(path, content, 'utf-8');
	return path;
}

function makeTempDir(): string {
	return join(
		tmpdir(),
		`elefant-ref-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
}

// ---------------------------------------------------------------------------
// resolveReference
// ---------------------------------------------------------------------------

describe('resolveReference', () => {
	let projectDir: string;
	let userDir: string;

	beforeEach(() => {
		projectDir = makeTempDir();
		userDir = makeTempDir();
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(userDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(projectDir, { recursive: true, force: true });
		} catch { /* best-effort */ }
		try {
			rmSync(userDir, { recursive: true, force: true });
		} catch { /* best-effort */ }
	});

	// -- Tier 1: Project override wins over builtin -------------------------

	it('returns project-level reference when it shadows a builtin', async () => {
		// handoff-format.md exists in builtin; create a project-level shadow
		writeRef(projectDir, 'handoff-format', '# Project Override');

		const result = await resolveReference('handoff-format', {
			cwd: projectDir,
			home: userDir,
		});

		expect(result).not.toBeNull();
		expect(result!.source).toBe('project');
		expect(result!.content).toContain('Project Override');
	});

	// -- Tier 2: User fallback when project missing -------------------------

	it('falls back to user-level reference when project tier is empty', async () => {
		writeUserRef(userDir, 'my-protocol', '# User Protocol');

		const result = await resolveReference('my-protocol', {
			cwd: projectDir,
			home: userDir,
		});

		expect(result).not.toBeNull();
		expect(result!.source).toBe('user');
		expect(result!.content).toBe('# User Protocol');
	});

	// -- Tier 3: Builtin fallback --------------------------------------------

	it('falls back to builtin reference when project and user are empty', async () => {
		const result = await resolveReference('handoff-format', {
			cwd: projectDir,
			home: userDir,
		});

		expect(result).not.toBeNull();
		expect(result!.source).toBe('builtin');
		expect(result!.path).toContain('src/agents/references/handoff-format.md');
	});

	// -- Missing file --------------------------------------------------------

	it('returns null for a name that does not exist in any tier', async () => {
		const result = await resolveReference('nonexistent-ref', {
			cwd: projectDir,
			home: userDir,
		});

		expect(result).toBeNull();
	});

	// -- All three tiers populated — project wins ---------------------------

	it('picks the project-level reference when all three tiers have the same name', async () => {
		// Project tier
		writeRef(projectDir, 'shared', '# Project Version');
		// User tier
		writeUserRef(userDir, 'shared', '# User Version');
		// Builtin tier has handoff-format (different name), so not a conflict
		// The test for the same name across all tiers can't easily override builtin,
		// so we test project-vs-user priority here and builtin fallback separately.

		const result = await resolveReference('shared', {
			cwd: projectDir,
			home: userDir,
		});

		expect(result).not.toBeNull();
		expect(result!.source).toBe('project');
		expect(result!.content).toBe('# Project Version');
	});

	// -- Name with hyphens / kebab-case --------------------------------------

	it('handles kebab-case reference names', async () => {
		writeRef(projectDir, 'my-long-ref-name', '# Kebab');

		const result = await resolveReference('my-long-ref-name', {
			cwd: projectDir,
			home: userDir,
		});

		expect(result).not.toBeNull();
		expect(result!.source).toBe('project');
	});

	// -- Project override over user (when builtin doesn't have it) ----------

	it('project overrides user when both exist and builtin does not', async () => {
		writeRef(projectDir, 'override-me', '# Project');
		writeUserRef(userDir, 'override-me', '# User');

		const result = await resolveReference('override-me', {
			cwd: projectDir,
			home: userDir,
		});

		expect(result!.source).toBe('project');
	});
});

// ---------------------------------------------------------------------------
// listReferences
// ---------------------------------------------------------------------------

describe('listReferences', () => {
	let projectDir: string;
	let userDir: string;

	beforeEach(() => {
		projectDir = makeTempDir();
		userDir = makeTempDir();
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(userDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(projectDir, { recursive: true, force: true });
		} catch { /* best-effort */ }
		try {
			rmSync(userDir, { recursive: true, force: true });
		} catch { /* best-effort */ }
	});

	// -- Deduplication: project name shadows same-named builtin -------------

	it('deduplicates by name — project tier wins over builtin', async () => {
		// handoff-format exists in builtin; create a project-level shadow
		writeRef(projectDir, 'handoff-format', '# Project Handoff');

		const refs = await listReferences({ cwd: projectDir, home: userDir });

		const handoffEntries = refs.filter((r) => r.name === 'handoff-format');
		expect(handoffEntries).toHaveLength(1);
		expect(handoffEntries[0].source).toBe('project');
	});

	// -- Deduplication: project name shadows user ----------------------------

	it('deduplicates by name — project tier wins over user', async () => {
		writeRef(projectDir, 'shared-ref', '# Project');
		writeUserRef(userDir, 'shared-ref', '# User');

		const refs = await listReferences({ cwd: projectDir, home: userDir });

		const sharedEntries = refs.filter((r) => r.name === 'shared-ref');
		expect(sharedEntries).toHaveLength(1);
		expect(sharedEntries[0].source).toBe('project');
	});

	// -- Sorted by name -----------------------------------------------------

	it('returns results sorted alphabetically by name', async () => {
		writeRef(projectDir, 'zeta', '');
		writeRef(projectDir, 'alpha', '');
		writeRef(projectDir, 'gamma', '');

		const refs = await listReferences({ cwd: projectDir, home: userDir });

		// Filter to only our test refs + builtin ones
		const names = refs.map((r) => r.name);
		const sorted = [...names].sort((a, b) => a.localeCompare(b));
		expect(names).toEqual(sorted);
	});

	// -- Description from frontmatter ----------------------------------------

	it('extracts description from frontmatter description: field', async () => {
		const content = [
			'---',
			'title: My Reference',
			'description: A frontmatter-described reference',
			'---',
			'',
			'# Body',
		].join('\n');

		writeRef(projectDir, 'with-frontmatter', content);

		const refs = await listReferences({ cwd: projectDir, home: userDir });
		const ref = refs.find((r) => r.name === 'with-frontmatter');

		expect(ref).toBeDefined();
		expect(ref!.description).toBe('A frontmatter-described reference');
	});

	// -- Description from quoted frontmatter value ---------------------------

	it('strips double quotes from frontmatter description', async () => {
		const content = [
			'---',
			'description: "A quoted description"',
			'---',
			'',
			'body',
		].join('\n');

		writeRef(projectDir, 'quoted-desc', content);

		const refs = await listReferences({ cwd: projectDir, home: userDir });
		const ref = refs.find((r) => r.name === 'quoted-desc');

		expect(ref!.description).toBe('A quoted description');
	});

	// -- Description fallback: first body line after frontmatter -------------

	it('falls back to first body line when frontmatter has no description field', async () => {
		const content = [
			'---',
			'title: No Description',
			'---',
			'',
			'# First body heading',
		].join('\n');

		writeRef(projectDir, 'no-frontmatter-desc', content);

		const refs = await listReferences({ cwd: projectDir, home: userDir });
		const ref = refs.find((r) => r.name === 'no-frontmatter-desc');

		expect(ref!.description).toBe('# First body heading');
	});

	// -- Description fallback: no frontmatter at all -------------------------

	it('uses first non-blank line as description when there is no frontmatter', async () => {
		writeRef(projectDir, 'plain', '# Just Markdown\n\nMore content.');

		const refs = await listReferences({ cwd: projectDir, home: userDir });
		const ref = refs.find((r) => r.name === 'plain');

		expect(ref!.description).toBe('# Just Markdown');
	});

	// -- Description fallback: empty content → sentinel ----------------------

	it('returns (no description) for a file with no readable text', async () => {
		const content = ['---', '---', '', ''].join('\n');
		writeRef(projectDir, 'empty-body', content);

		const refs = await listReferences({ cwd: projectDir, home: userDir });
		const ref = refs.find((r) => r.name === 'empty-body');

		expect(ref!.description).toBe('(no description)');
	});

	// -- Empty tiers are silently skipped ------------------------------------

	it('returns builtin refs when project and user dirs are missing', async () => {
		const refs = await listReferences({ cwd: projectDir, home: userDir });

		// At minimum, the seeded handoff-format.md should be present
		const builtinRefs = refs.filter((r) => r.source === 'builtin');
		expect(builtinRefs.length).toBeGreaterThanOrEqual(1);
		expect(builtinRefs.some((r) => r.name === 'handoff-format')).toBe(true);
	});

	// -- Source tagging ------------------------------------------------------

	it('tags source correctly for each tier', async () => {
		writeRef(projectDir, 'example', '# Example');
		writeUserRef(userDir, 'user-only', '# User Only');

		const refs = await listReferences({ cwd: projectDir, home: userDir });

		const exampleRef = refs.find((r) => r.name === 'example');
		expect(exampleRef).toBeDefined();
		expect(exampleRef!.source).toBe('project');

		const userRef = refs.find((r) => r.name === 'user-only');
		expect(userRef).toBeDefined();
		expect(userRef!.source).toBe('user');
	});

	// -- Path stored correctly ------------------------------------------------

	it('stores the full file path for each reference', async () => {
		const filePath = writeRef(projectDir, 'test-path', '# Test');
		const refs = await listReferences({ cwd: projectDir, home: userDir });
		const ref = refs.find((r) => r.name === 'test-path');

		expect(ref).toBeDefined();
		expect(ref!.path).toBe(filePath);
	});

	// -- Ignores non-.md files -----------------------------------------------

	it('ignores non-.md files in reference directories', async () => {
		const refDir = join(projectDir, '.elefant', 'references');
		mkdirSync(refDir, { recursive: true });

		writeFileSync(join(refDir, 'valid.md'), '# Valid');
		writeFileSync(join(refDir, 'notes.txt'), 'Not a reference');
		writeFileSync(join(refDir, '.gitkeep'), '');

		const refs = await listReferences({ cwd: projectDir, home: userDir });
		const names = refs.filter((r) => r.source === 'project').map((r) => r.name);

		expect(names).toContain('valid');
		expect(names).not.toContain('notes');
		expect(names).not.toContain('.gitkeep');
	});

	// -- Ignores subdirectories in reference directories ---------------------

	it('ignores subdirectories when scanning a reference tier', async () => {
		const refDir = join(projectDir, '.elefant', 'references');
		mkdirSync(join(refDir, 'nested-dir'), { recursive: true });
		writeFileSync(join(refDir, 'nested-dir', 'nested.md'), '# Nested');

		const refs = await listReferences({ cwd: projectDir, home: userDir });
		const projectNames = refs.filter((r) => r.source === 'project').map(
			(r) => r.name,
		);

		expect(projectNames).not.toContain('nested');
	});
});
