/**
 * research_grep tool — ripgrep scoped to `.elefant/markdown-db/`.
 *
 * Returns matches grouped by file with frontmatter-derived titles
 * and `research://` links. Delegates execution to the shared ripgrep
 * binary runner, then parses the JSON output and enriches it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { executeBinary, getRipgrepPath } from '../binary.js';
import { researchBaseDir } from '../../project/paths.js';
import { assertInsideResearchBase } from '../../research/membership.js';
import { parseFrontmatter } from '../../research/frontmatter.js';
import { serializeResearchLink } from '../../research/link.js';
import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';

// ─── Ripgrep JSON output types ──────────────────────────────────────────────

interface RipgrepText {
	text?: string;
	bytes?: string;
}

interface RipgrepMatchEvent {
	type: 'match';
	data: {
		path?: RipgrepText;
		line_number?: number;
		lines?: RipgrepText;
	};
}

// ─── Decode helpers ─────────────────────────────────────────────────────────

function decodeField(field: RipgrepText | undefined): string {
	if (!field) return '';

	if (typeof field.text === 'string') return field.text;

	if (typeof field.bytes === 'string') {
		try {
			return Buffer.from(field.bytes, 'base64').toString('utf-8');
		} catch {
			return '';
		}
	}

	return '';
}

function isMatchEvent(value: unknown): value is RipgrepMatchEvent {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { type?: unknown; data?: unknown };
	return candidate.type === 'match' && typeof candidate.data === 'object' && candidate.data !== null;
}

function isInvalidRegexError(stderr: string): boolean {
	return /regex parse error|invalid regex|error parsing regex/i.test(stderr);
}

function extractStderr(details: unknown): string {
	if (typeof details !== 'object' || details === null) return '';
	const value = details as { stderr?: unknown };
	return typeof value.stderr === 'string' ? value.stderr : '';
}

// ─── Tool params / result types ─────────────────────────────────────────────

export interface ResearchGrepParams {
	pattern: string;
	section?: string;
	include?: string;
	maxFiles?: number;
}

export interface ResearchGrepFileMatch {
	path: string;
	section: string;
	title: string;
	research_link: string;
	matches: Array<{ line: number; snippet: string }>;
	matchCount: number;
}

export interface ResearchGrepResult {
	files: ResearchGrepFileMatch[];
	totalMatches: number;
}

// ─── Tool definition ────────────────────────────────────────────────────────

export const researchGrepTool: ToolDefinition<ResearchGrepParams, string> = {
	name: 'research_grep',
	description:
		'Search the Research Base (.elefant/markdown-db/) using ripgrep. Returns matches grouped by file with frontmatter titles and research:// links.',
	parameters: {
		pattern: {
			type: 'string',
			description: 'Regex pattern to search for',
			required: true,
		},
		section: {
			type: 'string',
			description: 'Limit search to a specific section directory (e.g. "02-tech")',
			required: false,
		},
		include: {
			type: 'string',
			description: 'File glob pattern within the research base (e.g. "*.md")',
			required: false,
		},
		maxFiles: {
			type: 'number',
			description: 'Maximum number of unique files to return (default: 20)',
			required: false,
			default: 20,
		},
	},

	execute: async (params): Promise<Result<string, ElefantError>> => {
		const { pattern, section, include, maxFiles = 20 } = params;
		const projectPath = process.cwd();

		// ── Validate params ──

		if (!pattern || pattern.trim() === '') {
			return err({
				code: 'VALIDATION_ERROR',
				message: 'Pattern must not be empty',
			});
		}

		if (!Number.isInteger(maxFiles) || maxFiles <= 0) {
			return err({
				code: 'VALIDATION_ERROR',
				message: 'maxFiles must be a positive integer',
			});
		}

		// ── Resolve and validate search path ──

		const base = researchBaseDir(projectPath);
		const searchRoot = section ? join(base, section) : base;

		// The base directory itself passes by definition; section
		// subdirectories must be validated against traversal escapes.
		let searchPath: string;
		if (searchRoot === base) {
			searchPath = base;
		} else {
			const validated = assertInsideResearchBase(projectPath, searchRoot);
			if (!validated.ok) return err(validated.error);
			searchPath = validated.data;
		}

		// Non-existent section directories produce empty results
		if (!existsSync(searchPath)) {
			return ok(JSON.stringify({ files: [], totalMatches: 0 }));
		}

		// ── Run ripgrep ──

		const args: string[] = ['--json'];

		if (include) {
			args.push('--glob', include);
		}

		args.push(pattern, searchPath);

		const binaryPath = getRipgrepPath();
		const binaryResult = await executeBinary(binaryPath, args);

		if (!binaryResult.ok) {
			if (binaryResult.error.code === 'BINARY_NOT_FOUND') {
				return err(binaryResult.error);
			}

			const stderr = extractStderr(binaryResult.error.details);
			if (isInvalidRegexError(stderr)) {
				return err({
					code: 'VALIDATION_ERROR',
					message: `Invalid regex: ${stderr.trim()}`,
					details: binaryResult.error.details,
				});
			}

			return err({
				code: 'TOOL_EXECUTION_FAILED',
				message: binaryResult.error.message,
				details: binaryResult.error.details,
			});
		}

		// ── Parse ripgrep JSON output ──

		const output = binaryResult.data.stdout;
		if (output.trim() === '') {
			return ok(JSON.stringify({ files: [], totalMatches: 0 }));
		}

		const fileMatches = new Map<string, Array<{ line: number; snippet: string }>>();

		for (const line of output.split('\n')) {
			if (line.trim() === '') continue;

			try {
				const parsed = JSON.parse(line) as unknown;
				if (!isMatchEvent(parsed)) continue;

				const filePath = decodeField(parsed.data.path);
				const lineNumber = parsed.data.line_number ?? 0;
				const rawLine = decodeField(parsed.data.lines);
				const snippet = rawLine.replace(/[\r\n]+$/g, '').trim();

				if (!filePath) continue;

				if (!fileMatches.has(filePath)) {
					fileMatches.set(filePath, []);
				}

				fileMatches.get(filePath)!.push({ line: lineNumber, snippet });
			} catch {
				continue;
			}
		}

		// ── Group by file, cap at maxFiles ──

		const filePaths = [...fileMatches.keys()].slice(0, maxFiles);

		const files: ResearchGrepFileMatch[] = filePaths.map((absPath) => {
			const matches = fileMatches.get(absPath)!;
			const relPath = relative(base, absPath);

			// Derive section from first path segment
			const pathParts = relPath.split('/');
			const sectionName = pathParts.length > 1 ? pathParts[0] : '';

			// Try to get title from frontmatter; fall back to filename
			let title = basename(absPath);
			try {
				const raw = readFileSync(absPath, 'utf-8');
				const fmResult = parseFrontmatter(raw);
				if (fmResult.ok) {
					title = fmResult.data.frontmatter.title;
				}
			} catch {
				// Keep the filename fallback
			}

			const researchLink = serializeResearchLink({
				kind: 'research-uri',
				workflow: '_',
				path: relPath,
				anchor: null,
			});

			return {
				path: relPath,
				section: sectionName,
				title,
				research_link: researchLink,
				matches,
				matchCount: matches.length,
			};
		});

		const totalMatches = files.reduce((sum, f) => sum + f.matchCount, 0);

		return ok(
			JSON.stringify({
				files,
				totalMatches,
			} satisfies ResearchGrepResult),
		);
	},
};
