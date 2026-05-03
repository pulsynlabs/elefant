/**
 * research_grep tool tests — coverage for grouping, section scoping,
 * invalid regex, path traversal, and maxFiles cap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { researchGrepTool, type ResearchGrepResult } from './index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

let uuidCounter = 0;
function nextUuid(): string {
	const hex = (uuidCounter++).toString(16).padStart(12, '0');
	return `550e8400-e29b-41d4-a716-${hex}`;
}

function parseResult(result: { ok: true; data: string }): ResearchGrepResult {
	return JSON.parse(result.data) as ResearchGrepResult;
}

interface TempLayout {
	root: string;
	researchDir: string;
}

function setupTemp(): TempLayout {
	const root = mkdtempSync(join(tmpdir(), 'elefant-research-grep-test-'));
	const researchDir = join(root, '.elefant', 'markdown-db');
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

describe('research_grep', () => {
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

		const result = await researchGrepTool.execute({ pattern: 'elephant', maxFiles: 20 });

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
		expect(elephants!.research_link).toBe('research://_/02-tech/elephants.md');
		expect(elephants!.matches.length).toBeGreaterThanOrEqual(1);
		expect(elephants!.matchCount).toBe(elephants!.matches.length);

		expect(zoology!.title).toBe('General Zoology');
		expect(zoology!.research_link).toBe('research://_/02-tech/zoology.md');
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

		const result = await researchGrepTool.execute({ pattern: 'nonexistent_term_xyz', maxFiles: 20 });

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

		const result = await researchGrepTool.execute({
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

		const result = await researchGrepTool.execute({
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
		const result = await researchGrepTool.execute({ pattern: '[invalid', maxFiles: 20 });

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

		const result = await researchGrepTool.execute({
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

		const result = await researchGrepTool.execute({ pattern: 'Matchable', maxFiles: 3 });

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

		const result = await researchGrepTool.execute({ pattern: 'elephants', maxFiles: 20 });

		expect(result.ok).toBe(true);
		const data = parseResult(result as { ok: true; data: string });

		expect(data.files).toHaveLength(1);
		expect(data.files[0].title).toBe('notes.md');
		expect(data.files[0].research_link).toBe('research://_/99-scratch/notes.md');
	});
});
