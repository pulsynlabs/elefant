import { join, resolve } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';

import type { CodebaseDigest, ManifestInfo } from './types.ts';
import { INSTRUCTION_FILES } from './types.ts';

function withinRoot(root: string, candidate: string): boolean {
	const rel = candidate.slice(root.length);
	return candidate === root || (candidate.startsWith(root) && (rel.startsWith('/') || rel.startsWith('\\')));
}

async function readTextIfExists(filePath: string): Promise<string | null> {
	try {
		const file = Bun.file(filePath);
		if (!(await file.exists())) return null;
		return await file.text();
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function toStringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw === 'string') out[key] = raw;
	}
	return out;
}

function parseWorkspaces(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string');
	}
	if (isRecord(value) && Array.isArray(value.packages)) {
		return value.packages.filter((item): item is string => typeof item === 'string');
	}
	return [];
}

function listRootConfigFiles(root: string): string[] {
	try {
		const entries = readdirSync(root, { withFileTypes: true });
		const matches = entries
			.filter((entry) => entry.isFile())
			.filter((entry) => {
				const n = entry.name;
				return (
					/^tsconfig.*\.json$/i.test(n) ||
					/^vite\.config\..+$/i.test(n) ||
					/^playwright\.config\..+$/i.test(n) ||
					/^vitest\.config\..+$/i.test(n) ||
					/^jest\.config\..+$/i.test(n)
				);
			})
			.map((entry) => join(root, entry.name));
		return matches.sort();
	} catch {
		return [];
	}
}

function listCiFiles(root: string): string[] {
	const workflowsDir = join(root, '.github', 'workflows');
	try {
		const entries = readdirSync(workflowsDir, { withFileTypes: true })
			.filter((entry) => entry.isFile())
			.filter((entry) => /\.ya?ml$/i.test(entry.name))
			.map((entry) => join(workflowsDir, entry.name))
			.sort();
		return entries.slice(0, 5);
	} catch {
		return [];
	}
}

function listMonorepoPackages(root: string): string[] {
	const results: string[] = [];
	for (const dirName of ['packages', 'apps']) {
		const dirPath = join(root, dirName);
		try {
			const children = readdirSync(dirPath, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => join(dirPath, entry.name));
			results.push(...children);
		} catch {
			// Ignore missing directories.
		}
	}
	return [...new Set(results)].sort();
}

async function readExistingInstruction(root: string): Promise<{ filepath: string; content: string } | null> {
	for (const filename of INSTRUCTION_FILES) {
		const absPath = join(root, filename);
		const content = await readTextIfExists(absPath);
		if (content !== null) {
			return {
				filepath: absPath,
				content: content.slice(0, 10 * 1024),
			};
		}
	}
	return null;
}

async function readReadmeSummary(root: string): Promise<string | null> {
	try {
		const entries = readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name);

		const preferred = entries.find((name) => name.toLowerCase() === 'readme.md');
		const fallback = entries.find((name) => /^readme\..+/i.test(name));
		const selected = preferred ?? fallback;
		if (!selected) return null;

		const content = await readTextIfExists(join(root, selected));
		if (content === null) return null;
		return content.slice(0, 500);
	} catch {
		return null;
	}
}

/**
 * Analyze a project root and return a structured CodebaseDigest.
 * Used by the Writer subagent as context for authoring AGENTS.md.
 * Pure function: no LLM calls, no caching, reads files directly.
 */
export async function analyzeCodebase(projectRoot: string): Promise<CodebaseDigest> {
	const root = resolve(projectRoot);

	let manifest: ManifestInfo | null = null;
	let scripts: Record<string, string> = {};
	let workspaces: string[] = [];

	const packageJsonPath = join(root, 'package.json');
	const packageJsonText = await readTextIfExists(packageJsonPath);

	if (packageJsonText !== null) {
		try {
			const parsed = JSON.parse(packageJsonText) as unknown;
			if (isRecord(parsed)) {
				scripts = toStringRecord(parsed.scripts);
				workspaces = parseWorkspaces(parsed.workspaces);
				manifest = {
					name: typeof parsed.name === 'string' ? parsed.name : undefined,
					description: typeof parsed.description === 'string' ? parsed.description : undefined,
					scripts,
					dependencies: toStringRecord(parsed.dependencies),
					devDependencies: toStringRecord(parsed.devDependencies),
					workspaces,
				};
			}
		} catch {
			manifest = null;
			scripts = {};
			workspaces = [];
		}
	} else {
		// Minimal fallback support for bun.toml presence when package.json is absent.
		const bunToml = await readTextIfExists(join(root, 'bun.toml'));
		if (bunToml !== null) {
			manifest = {};
		}
	}

	const existingInstruction = await readExistingInstruction(root);
	const configFiles = listRootConfigFiles(root);
	const ciFiles = listCiFiles(root);
	const monorepoPackages = listMonorepoPackages(root);
	const readmeSummary = await readReadmeSummary(root);

	const hasWorkspaceMarkers = workspaces.length > 0 || existsSync(join(root, 'packages')) || existsSync(join(root, 'apps'));
	const isMonorepo = hasWorkspaceMarkers;

	const hasPlaywright = configFiles.some((file) => /playwright\.config\./i.test(file));
	const hasVitest = configFiles.some((file) => /vitest\.config\./i.test(file));
	const hasJest = configFiles.some((file) => /jest\.config\./i.test(file));

	const scriptValues = Object.values(scripts).join(' ').toLowerCase();
	const scriptNames = Object.keys(scripts).join(' ').toLowerCase();
	const hasBunLock = existsSync(join(root, 'bun.lockb'));
	const hasNodeModules = existsSync(join(root, 'node_modules'));

	const hasTests =
		hasPlaywright ||
		hasVitest ||
		hasJest ||
		scriptNames.includes('test') ||
		scriptValues.includes('bun test');

	let testFramework: CodebaseDigest['stack']['testFramework'] = 'unknown';
	if (hasPlaywright) testFramework = 'playwright';
	else if (hasVitest) testFramework = 'vitest';
	else if (hasJest) testFramework = 'jest';
	else if (scriptValues.includes('bun test') || scripts.test?.includes('bun test')) testFramework = 'bun';

	const digest: CodebaseDigest = {
		projectRoot: root,
		manifest,
		scripts,
		isMonorepo,
		monorepoPackages: monorepoPackages.filter((path) => withinRoot(root, path)),
		existingInstruction: existingInstruction && withinRoot(root, existingInstruction.filepath) ? existingInstruction : null,
		configFiles: configFiles.filter((path) => withinRoot(root, path)),
		ciFiles: ciFiles.filter((path) => withinRoot(root, path)),
		readmeSummary,
		stack: {
			typescript: configFiles.some((file) => /\/tsconfig.*\.json$/i.test(file) || /\\tsconfig.*\.json$/i.test(file)),
			bun: hasBunLock || scriptValues.includes('bun '),
			node: packageJsonText !== null || hasNodeModules,
			hasTests,
			testFramework,
		},
	};

	return digest;
}
