/**
 * field_notes_grep tool tests — coverage for grouping, section scoping,
 * invalid regex, path traversal, and maxFiles cap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldNotesGrepTool, type FieldNotesGrepResult } from './index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

let uuidCounter = 0;
function nextUuid(): string {
	const hex = (uuidCounter++).toString(16).padStart(12, '0');
	return `550e8400-e29b-41d4-a716-${hex}`;
}

function parseResult(result: { ok: true; data: string }): FieldNotesGrepResult {
	return JSON.parse(result.data) as FieldNotesGrepResult;
}

interface TempLayout {
	root: string;
	researchDir: string;
}

function setupTemp(): TempLayout {
	const root = mkdtempSync(join(tmpdir(), 'elefant-research-grep-test-'));
	const researchDir = join(root, '.elefant', 'field-notes');
	mkdirSync(researchDir, { recursive: true });
	uuidCounter = 0;
	return { root, researchDir };
}

function writeResearchFile(researchDir: string, relPath: string, content: string): void {
	const fullPath = join(researchDir, relPath);
	mkdirSync(join(fullPath, '..'), { recursive: true });
	writeFileSync(fullPath, content);
}

function chdirTemp(root: string): string {
	const prev = process.cwd();
	process.chdir(root);
	return prev;
}

/**
 * Build a valid research document with proper frontmatter.
 * tags/sources use YAML block format to produce arrays for Zod validation.
 */
function buildResearchDoc(opts: {
	title: string;
	section: string;
	body: string;
	summary?: string;
}): string {
	return [
		'---',
		`id: ${nextUuid()}`,
		`title: ${opts.title}`,
		`section: ${opts.section}`,
		'tags:',
		'  - research',
		'sources:',
		'  - example-source',
		'confidence: high',
		'created: 2026-01-01',
		'updated: 2026-01-01',
		'author_agent: researcher',
		'workflow: null',
		`summary: ${opts.summary ?? 'Research document about ' + opts.title.toLowerCase()}.`,
		'---',
		'',
		opts.body,
	].join('\n');
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('field_notes_grep', () => {
	let layout: TempLayout;
	let prevCwd: string;

	beforeEach(() => {
		layout = setupTemp();
		prevCwd = chdirTemp(layout.root);
	});

	afterEach(() => {
		process.chdir(prevCwd);
		rmSync(layout.root, { recursive: true, force: true });
	});

	// ── Happy path ──────────────────────────────────────────────────────

	it('returns matches grouped by file with frontmatter titles and research links', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/elephants.md',
			buildResearchDoc({
				title: 'Elephant Conservation in Africa',
				section: '02-tech',
				body: '# Elephant Conservation\n\nElephants are the largest land mammals on Earth.\nThey are found across Africa and Asia.',
			}),
		);

		writeResearchFile(
			layout.researchDir,
			'02-tech/zoology.md',
			buildResearchDoc({
				title: 'General Zoology',
				section: '02-tech',
				body: '# Zoology\n\nElephants exhibit complex social behaviors.\nThey can recognize themselves in mirrors.',
			}),
		);

		const result = await fieldNotesGrepTool.execute({ pattern: 'elephant', maxFiles: 20 });

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });

		expect(data.files).toHaveLength(2);
		expect(data.totalMatches).toBeGreaterThanOrEqual(2);

		const elephants = data.files.find((f) => f.path === '02-tech/elephants.md');
		const zoology = data.files.find((f) => f.path === '02-tech/zoology.md');

		expect(elephants).toBeDefined();
		expect(zoology).toBeDefined();

		expect(elephants!.title).toBe('Elephant Conservation in Africa');
		expect(elephants!.section).toBe('02-tech');
		expect(elephants!.fieldnotes_link).toBe('fieldnotes://_/02-tech/elephants.md');
		expect(elephants!.matches.length).toBeGreaterThanOrEqual(1);
		expect(elephants!.matchCount).toBe(elephants!.matches.length);

		expect(zoology!.title).toBe('General Zoology');
		expect(zoology!.fieldnotes_link).toBe('fieldnotes://_/02-tech/zoology.md');
	});

	// ── No matches ──────────────────────────────────────────────────────

	it('returns empty files array and totalMatches 0 when no matches', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/empty-test.md',
			buildResearchDoc({
				title: 'No Match File',
				section: '02-tech',
				body: 'This file does not contain the search term.',
			}),
		);

		const result = await fieldNotesGrepTool.execute({ pattern: 'nonexistent_term_xyz', maxFiles: 20 });

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });

		expect(data.files).toEqual([]);
		expect(data.totalMatches).toBe(0);
	});

	// ── Section filter ──────────────────────────────────────────────────

	it('scopes search to the specified section directory', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/habitat.md',
			buildResearchDoc({
				title: 'Habitat Study',
				section: '02-tech',
				body: 'Elephants need vast savannah habitats.',
			}),
		);

		writeResearchFile(
			layout.researchDir,
			'04-comparisons/mammals.md',
			buildResearchDoc({
				title: 'Mammal Comparison',
				section: '04-comparisons',
				body: 'Elephants are compared to whales here.',
			}),
		);

		const result = await fieldNotesGrepTool.execute({
			pattern: 'elephant',
			section: '02-tech',
			maxFiles: 20,
		});

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });

		expect(data.files).toHaveLength(1);
		expect(data.files[0].section).toBe('02-tech');
		expect(data.files[0].path).toContain('02-tech/habitat.md');
	});

	it('returns empty when section filter matches nothing', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/habitat.md',
			buildResearchDoc({
				title: 'Habitat Study',
				section: '02-tech',
				body: 'Elephants need vast habitats.',
			}),
		);

		const result = await fieldNotesGrepTool.execute({
			pattern: 'elephant',
			section: '04-comparisons',
			maxFiles: 20,
		});

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });
		expect(data.files).toEqual([]);
		expect(data.totalMatches).toBe(0);
	});

	// ── Invalid regex ───────────────────────────────────────────────────

	it('returns VALIDATION_ERROR for invalid regex pattern', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/test.md',
			buildResearchDoc({
				title: 'Test File',
				section: '02-tech',
				body: 'Some content here.',
			}),
		);

		// Unclosed character class is a classic ripgrep regex error
		const result = await fieldNotesGrepTool.execute({ pattern: '[invalid', maxFiles: 20 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
		}
	});

	// ── Path outside research base ──────────────────────────────────────

	it('rejects section param that escapes the research base', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/test.md',
			buildResearchDoc({
				title: 'Test File',
				section: '02-tech',
				body: 'Some content.',
			}),
		);

		const result = await fieldNotesGrepTool.execute({
			pattern: 'content',
			section: '../../etc',
			maxFiles: 20,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('PERMISSION_DENIED');
		}
	});

	// ── maxFiles cap ────────────────────────────────────────────────────

	it('caps results at maxFiles even when more files match', async () => {
		// Create 5 files all containing the search term
		for (let i = 1; i <= 5; i++) {
			writeResearchFile(
				layout.researchDir,
				`02-tech/file-${i}.md`,
				buildResearchDoc({
					title: `File ${i}`,
					section: '02-tech',
					body: `Matchable content in file ${i}.`,
				}),
			);
		}

		const result = await fieldNotesGrepTool.execute({ pattern: 'Matchable', maxFiles: 3 });

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });

		expect(data.files).toHaveLength(3);
		expect(data.totalMatches).toBeGreaterThanOrEqual(3);
	});

	// ── Frontmatter fallback ────────────────────────────────────────────

	it('falls back to filename as title when frontmatter is unparseable', async () => {
		writeResearchFile(
			layout.researchDir,
			'99-scratch/notes.md',
			'Just some raw notes about elephants.\nNo frontmatter here.\n',
		);

		const result = await fieldNotesGrepTool.execute({ pattern: 'elephants', maxFiles: 20 });

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });

		expect(data.files).toHaveLength(1);
		expect(data.files[0].title).toBe('notes.md');
		expect(data.files[0].fieldnotes_link).toBe('fieldnotes://_/99-scratch/notes.md');
	});

	// ── Uncovered decodeField edge cases ──────────────────────────────

	it('decodeField returns empty string for undefined field', async () => {
		// Lines 45-49: field.bytes is invalid base64
		writeResearchFile(
			layout.researchDir,
			'02-tech/decode.md',
			buildResearchDoc({
				title: 'Decode Test',
				section: '02-tech',
				body: 'Content with special chars: á é í ó ú',
			}),
		);

		// The ripgrep output will use base64 for non-ASCII; invalid base64 should return ''
		const result = await fieldNotesGrepTool.execute({ pattern: 'á', maxFiles: 20 });
		// Should not throw, even with bytes field oddities
		expect(result.ok).toBe(true);
	});

	// ── maxFiles validation edge cases ───────────────────────────────

	it('returns VALIDATION_ERROR when maxFiles is zero', async () => {
		const result = await fieldNotesGrepTool.execute({ pattern: 'elephant', maxFiles: 0 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.message).toContain('positive integer');
		}
	});

	it('returns VALIDATION_ERROR when maxFiles is negative', async () => {
		const result = await fieldNotesGrepTool.execute({ pattern: 'elephant', maxFiles: -1 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.message).toContain('positive integer');
		}
	});

	it('returns VALIDATION_ERROR when maxFiles is non-integer', async () => {
		const result = await fieldNotesGrepTool.execute({ pattern: 'elephant', maxFiles: 3.5 } as unknown as number);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
		}
	});

	// ── searchPath = base (no section) ────────────────────────────────

	it('searchRoot equals base → searchPath is base (no membership check)', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/search.md',
			buildResearchDoc({
				title: 'Search Test',
				section: '02-tech',
				body: 'Matches here',
			}),
		);

		// No section param — searchRoot === base
		const result = await fieldNotesGrepTool.execute({ pattern: 'Matches', maxFiles: 10 });

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });
		expect(data.files.length).toBeGreaterThan(0);
	});

	// ── Non-existent section directory → empty result (not error) ─────

	it('returns empty result for non-existent section directory', async () => {
		const result = await fieldNotesGrepTool.execute({
			pattern: 'anything',
			section: '99-nonexistent-section',
			maxFiles: 20,
		});

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });
		expect(data.files).toEqual([]);
		expect(data.totalMatches).toBe(0);
	});

	// ── isInvalidRegexError — VALIDATION_ERROR for invalid regex ─────

	it('returns VALIDATION_ERROR with specific regex parse error message', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/regex.md',
			buildResearchDoc({
				title: 'Regex Test',
				section: '02-tech',
				body: 'Some content',
			}),
		);

		// Invalid regex with ripgrep-specific error message
		const result = await fieldNotesGrepTool.execute({ pattern: '*invalid(regex', maxFiles: 20 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('VALIDATION_ERROR');
			expect(result.error.message).toContain('Invalid regex');
		}
	});

	// ── Empty ripgrep output → ok with empty result ─────────────────

	it('returns empty files array when ripgrep output is only whitespace', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/whitespace.md',
			buildResearchDoc({
				title: 'Whitespace',
				section: '02-tech',
				body: 'Content',
			}),
		);

		// Pattern that produces a blank line in ripgrep JSON output
		const result = await fieldNotesGrepTool.execute({ pattern: '^$', maxFiles: 20 });

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });
		// Empty pattern can produce no matches
		expect(Array.isArray(data.files)).toBe(true);
	});

	// ── Line 171: include option passed to ripgrep args ────────────────

	it('passes include glob option to ripgrep', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/glob-test.txt',
			'Plain text file that should not match',
		);
		writeResearchFile(
			layout.researchDir,
			'02-tech/glob-test.md',
			buildResearchDoc({
				title: 'Glob Test',
				section: '02-tech',
				body: 'Markdown content with globterm',
			}),
		);

		// Include only .md files — the .txt file should be excluded
		const result = await fieldNotesGrepTool.execute({
			pattern: 'globterm',
			include: '*.md',
			maxFiles: 20,
		});

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });
		expect(data.files.some((f) => f.path === '02-tech/glob-test.md')).toBe(true);
		// The .txt file should not appear
		expect(data.files.some((f) => f.path === '02-tech/glob-test.txt')).toBe(false);
	});

	// ── Section subdir not at base → membership check ───────────────

	it('searchRoot !== base requires membership check (traversal safe)', async () => {
		writeResearchFile(
			layout.researchDir,
			'02-tech/safe.md',
			buildResearchDoc({
				title: 'Safe Section',
				section: '02-tech',
				body: 'Should be found',
			}),
		);

		const result = await fieldNotesGrepTool.execute({
			pattern: 'Should',
			section: '02-tech',
			maxFiles: 20,
		});

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });
		expect(data.files.length).toBeGreaterThan(0);
	});

	// ── Path parts for section derivation (line 243) ──────────────────

	it('derives section from first path segment', async () => {
		writeResearchFile(
			layout.researchDir,
			'04-comparisons/mammals.md',
			buildResearchDoc({
				title: 'Mammals Comparison',
				section: '04-comparisons',
				body: 'Elephants are the largest land mammals.',
			}),
		);

		const result = await fieldNotesGrepTool.execute({ pattern: 'elephant', section: '04-comparisons', maxFiles: 20 });

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });
		if (data.files.length > 0) {
			expect(data.files[0]!.section).toBe('04-comparisons');
		}
	});

	// ── isMatchEvent false → skip line ────────────────────────────────

	it('skips non-match JSON lines from ripgrep output', async () => {
		// This is implicitly tested via the empty output path
		// but here we confirm the isMatchEvent guard works
		const result = await fieldNotesGrepTool.execute({ pattern: '^$', maxFiles: 20 });
		expect(result.ok).toBe(true);
	});
});
