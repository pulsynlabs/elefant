import type { Stats } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import type { Elysia } from 'elysia';

/**
 * Security design for remote directory listing:
 * - Treat the query path as hostile input and reject any `..` path segment before resolution.
 * - Resolve all accepted input with `path.resolve()` and only operate on the resolved path.
 * - Apply a conservative deny-list for sensitive system roots and common secret-bearing home directories.
 * - Re-check the resolved path for traversal markers and deny-list membership before touching the filesystem.
 * - Inspect each child with `lstat()`; symlinks are resolved and only returned when their real target remains
 *   within the directory being listed, preventing a directory from smuggling access to sensitive locations.
 */

export interface FsEntryResponse {
	name: string;
	isDir: boolean;
}

export interface FsListResponseData {
	path: string;
	parent: string | null;
	entries: FsEntryResponse[];
}

export type FsListResponse =
	| { ok: true; data: FsListResponseData }
	| { ok: false; error: string };

interface FsListDependencies {
	lstat: typeof lstat;
	readdir: typeof readdir;
	realpath: typeof realpath;
	stat: typeof stat;
	homedir: typeof homedir;
}

const defaultDependencies: FsListDependencies = {
	lstat,
	readdir,
	realpath,
	stat,
	homedir,
};

const DENIED_SYSTEM_PATHS = ['/etc', '/proc', '/sys', '/boot', '/dev', '/run'] as const;
const DENIED_HOME_RELATIVE_PATHS = [
	'.ssh',
	'.gnupg',
	'.aws',
	'.config/google-chrome',
	'.config/chromium',
	'.config/BraveSoftware',
	'.mozilla',
	'.pki',
	'.kube',
	'.docker',
] as const;

function hasTraversalSegment(pathValue: string): boolean {
	return pathValue.split(/[\\/]+/u).some((segment) => segment === '..');
}

function isPathAtOrInside(candidate: string, parent: string): boolean {
	return candidate === parent || candidate.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function deniedResolvedPaths(homePath: string): string[] {
	return [
		...DENIED_SYSTEM_PATHS.map((pathValue) => resolve(pathValue)),
		...DENIED_HOME_RELATIVE_PATHS.map((pathValue) => resolve(homePath, pathValue)),
	];
}

function isDeniedPath(pathValue: string, homePath: string): boolean {
	return deniedResolvedPaths(homePath).some((deniedPath) => isPathAtOrInside(pathValue, deniedPath));
}

function parentFor(pathValue: string): string | null {
	const parent = dirname(pathValue);
	return parent === pathValue ? null : parent;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function safeEntryIsDirectory(
	deps: FsListDependencies,
	listedDirectory: string,
	entryPath: string,
): Promise<boolean | null> {
	let entryStats: Stats;
	try {
		entryStats = await deps.lstat(entryPath);
	} catch {
		return null;
	}

	if (!entryStats.isSymbolicLink()) {
		return entryStats.isDirectory();
	}

	try {
		const targetPath = await deps.realpath(entryPath);
		if (!isPathAtOrInside(targetPath, listedDirectory)) {
			return null;
		}

		const targetStats = await deps.stat(targetPath);
		return targetStats.isDirectory();
	} catch {
		return null;
	}
}

async function listDirectory(
	pathInput: string | undefined,
	deps: FsListDependencies,
): Promise<{ status: number; body: FsListResponse }> {
	const rawPath = pathInput?.trim() ? pathInput : deps.homedir();

	if (hasTraversalSegment(rawPath)) {
		return { status: 400, body: { ok: false, error: 'Path traversal is not allowed' } };
	}

	if (!isAbsolute(rawPath)) {
		return { status: 400, body: { ok: false, error: 'Path must be absolute' } };
	}

	const resolvedPath = resolve(rawPath);
	const homePath = resolve(deps.homedir());

	if (hasTraversalSegment(resolvedPath)) {
		return { status: 400, body: { ok: false, error: 'Path traversal is not allowed' } };
	}

	if (isDeniedPath(resolvedPath, homePath)) {
		return { status: 400, body: { ok: false, error: 'Path is not allowed' } };
	}

	let directoryStats: Stats;
	try {
		directoryStats = await deps.lstat(resolvedPath);
	} catch (error) {
		const code = errorCode(error);
		if (code === 'ENOENT') {
			return { status: 404, body: { ok: false, error: 'Path not found' } };
		}
		return { status: 500, body: { ok: false, error: errorMessage(error) } };
	}

	if (!directoryStats.isDirectory()) {
		return { status: 400, body: { ok: false, error: 'Path is not a directory' } };
	}

	let names: string[];
	try {
		names = await deps.readdir(resolvedPath);
	} catch (error) {
		return { status: 500, body: { ok: false, error: errorMessage(error) } };
	}

	const entries: FsEntryResponse[] = [];
	for (const name of names) {
		const entryPath = resolve(resolvedPath, name);
		if (!isPathAtOrInside(entryPath, resolvedPath)) {
			continue;
		}

		const isDir = await safeEntryIsDirectory(deps, resolvedPath, entryPath);
		if (isDir === null) {
			continue;
		}

		entries.push({ name, isDir });
	}

	entries.sort((left, right) => {
		if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
		return left.name.localeCompare(right.name);
	});

	return {
		status: 200,
		body: {
			ok: true,
			data: {
				path: resolvedPath,
				parent: parentFor(resolvedPath),
				entries,
			},
		},
	};
}

export function mountFsRoutes(app: Elysia, deps: FsListDependencies = defaultDependencies): void {
	app.get('/api/fs/list', async ({ query, set }) => {
		const pathQuery = typeof query.path === 'string' ? query.path : undefined;
		const result = await listDirectory(pathQuery, deps);
		set.status = result.status;
		return result.body;
	});
}
