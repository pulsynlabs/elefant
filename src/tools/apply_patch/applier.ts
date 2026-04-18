import { mkdtemp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { err, ok } from '../../types/result.js';
import type { DeleteFileOperation, PatchHunk, PatchOperation, UpdateFileOperation } from './parser.js';

export interface ApplyPatchSummary {
	added: string[];
	modified: string[];
	deleted: string[];
}

interface BackupEntry {
	originalPath: string;
	backupPath: string;
}

const APPLY_PATCH_TMP_PREFIX = 'elefant-apply-patch-';

function toError(code: ElefantError['code'], message: string): ElefantError {
	return { code, message };
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

function toRelativePath(rootDir: string, absolutePath: string): string {
	return relative(rootDir, absolutePath).split('\\').join('/');
}

function resolveWithinRoot(rootDir: string, patchPath: string): Result<string, ElefantError> {
	const candidate = isAbsolute(patchPath) ? resolve(patchPath) : resolve(rootDir, patchPath);
	const relativePath = relative(rootDir, candidate);

	if (relativePath.startsWith('..') || relativePath === '' || isAbsolute(relativePath)) {
		return err(toError('PERMISSION_DENIED', `Path escapes project root: ${patchPath}`));
	}

	return ok(candidate);
}

function applyHunkLines(currentLines: string[], hunk: PatchHunk, hunkIndex: number, filePath: string): Result<string[], ElefantError> {
	const matchPattern = hunk.lines.filter((line) => line.type !== 'add');
	const replacement = hunk.lines.filter((line) => line.type !== 'remove').map((line) => line.text);

	if (matchPattern.length === 0) {
		return ok([...replacement, ...currentLines]);
	}

	for (let start = 0; start <= currentLines.length - matchPattern.length; start += 1) {
		let matches = true;
		for (let offset = 0; offset < matchPattern.length; offset += 1) {
			const expected = matchPattern[offset];
			const actual = currentLines[start + offset];
			if (!actual || actual !== expected.text) {
				matches = false;
				break;
			}
		}

		if (!matches) {
			continue;
		}

		const nextLines = [
			...currentLines.slice(0, start),
			...replacement,
			...currentLines.slice(start + matchPattern.length),
		];
		return ok(nextLines);
	}

	return err(
		toError(
			'TOOL_EXECUTION_FAILED',
			`Hunk ${hunkIndex + 1} context mismatch for ${filePath}. Patch could not be applied.`,
		),
	);
}

function applyHunks(originalContent: string, operation: UpdateFileOperation): Result<string, ElefantError> {
	let lines = originalContent.split('\n');

	for (let index = 0; index < operation.hunks.length; index += 1) {
		const applyResult = applyHunkLines(lines, operation.hunks[index], index, operation.path);
		if (!applyResult.ok) {
			return applyResult;
		}
		lines = applyResult.data;
	}

	return ok(lines.join('\n'));
}

function classifyFileReadError(filePath: string, error: unknown): ElefantError {
	if (error instanceof Error) {
		if (error.message.includes('ENOENT')) {
			return toError('FILE_NOT_FOUND', `File not found: ${filePath}`);
		}
		if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
			return toError('PERMISSION_DENIED', `Permission denied: ${filePath}`);
		}
	}

	return toError(
		'TOOL_EXECUTION_FAILED',
		`Failed to read file: ${filePath} (${error instanceof Error ? error.message : String(error)})`,
	);
}

export async function applyPatchOperations(
	operations: PatchOperation[],
	rootDir: string = process.cwd(),
): Promise<Result<ApplyPatchSummary, ElefantError>> {
	const absoluteRoot = resolve(rootDir);
	const stagedWrites = new Map<string, string>();
	const stagedDeletes = new Set<string>();

	const summary: ApplyPatchSummary = {
		added: [],
		modified: [],
		deleted: [],
	};

	const getVirtualContent = async (absolutePath: string): Promise<Result<string | null, ElefantError>> => {
		if (stagedDeletes.has(absolutePath)) {
			return ok(null);
		}

		const staged = stagedWrites.get(absolutePath);
		if (staged !== undefined) {
			return ok(staged);
		}

		if (!(await pathExists(absolutePath))) {
			return ok(null);
		}

		try {
			const content = await Bun.file(absolutePath).text();
			return ok(content);
		} catch (error) {
			return err(classifyFileReadError(absolutePath, error));
		}
	};

	for (const operation of operations) {
		const sourcePathResult = resolveWithinRoot(absoluteRoot, operation.path);
		if (!sourcePathResult.ok) {
			return sourcePathResult;
		}

		const sourcePath = sourcePathResult.data;

		if (operation.type === 'add') {
			const existing = await getVirtualContent(sourcePath);
			if (!existing.ok) {
				return existing;
			}
			if (existing.data !== null) {
				return err(toError('TOOL_EXECUTION_FAILED', `Cannot add file that already exists: ${operation.path}`));
			}

			stagedDeletes.delete(sourcePath);
			stagedWrites.set(sourcePath, operation.content);
			summary.added.push(toRelativePath(absoluteRoot, sourcePath));
			continue;
		}

		if (operation.type === 'update') {
			const existing = await getVirtualContent(sourcePath);
			if (!existing.ok) {
				return existing;
			}
			if (existing.data === null) {
				return err(toError('FILE_NOT_FOUND', `File not found for update: ${operation.path}`));
			}

			const patchedContent = applyHunks(existing.data, operation);
			if (!patchedContent.ok) {
				return patchedContent;
			}

			let destinationPath = sourcePath;
			if (operation.moveTo) {
				const movePathResult = resolveWithinRoot(absoluteRoot, operation.moveTo);
				if (!movePathResult.ok) {
					return movePathResult;
				}
				destinationPath = movePathResult.data;

				if (destinationPath !== sourcePath) {
					const destinationContent = await getVirtualContent(destinationPath);
					if (!destinationContent.ok) {
						return destinationContent;
					}
					if (destinationContent.data !== null) {
						return err(
							toError('TOOL_EXECUTION_FAILED', `Cannot move update target onto existing file: ${operation.moveTo}`),
						);
					}
				}
			}

			stagedWrites.set(destinationPath, patchedContent.data);
			if (destinationPath !== sourcePath) {
				stagedDeletes.add(sourcePath);
				stagedWrites.delete(sourcePath);
			}

			summary.modified.push(toRelativePath(absoluteRoot, destinationPath));
			continue;
		}

		const deleteOperation = operation as DeleteFileOperation;
		const existing = await getVirtualContent(sourcePath);
		if (!existing.ok) {
			return existing;
		}
		if (existing.data === null) {
			return err(toError('FILE_NOT_FOUND', `File not found for delete: ${operation.path}`));
		}

		if (deleteOperation.moveTo) {
			const movePathResult = resolveWithinRoot(absoluteRoot, deleteOperation.moveTo);
			if (!movePathResult.ok) {
				return movePathResult;
			}
			const destinationPath = movePathResult.data;

			if (destinationPath !== sourcePath) {
				const destinationContent = await getVirtualContent(destinationPath);
				if (!destinationContent.ok) {
					return destinationContent;
				}
				if (destinationContent.data !== null) {
					return err(
						toError('TOOL_EXECUTION_FAILED', `Cannot move delete target onto existing file: ${deleteOperation.moveTo}`),
					);
				}
			}

			stagedWrites.set(destinationPath, existing.data);
			stagedDeletes.add(sourcePath);
			summary.modified.push(toRelativePath(absoluteRoot, destinationPath));
		} else {
			stagedDeletes.add(sourcePath);
			stagedWrites.delete(sourcePath);
			summary.deleted.push(toRelativePath(absoluteRoot, sourcePath));
		}
	}

	for (const writePath of stagedWrites.keys()) {
		stagedDeletes.delete(writePath);
	}

	const tempRoot = await mkdtemp(resolve(tmpdir(), APPLY_PATCH_TMP_PREFIX));
	const backups: BackupEntry[] = [];
	const createdFiles = new Set<string>();

	try {
		for (const [targetPath, content] of stagedWrites.entries()) {
			const existed = await pathExists(targetPath);
			if (existed) {
				const backupPath = resolve(tempRoot, `backup-${backups.length}`);
				await rename(targetPath, backupPath);
				backups.push({ originalPath: targetPath, backupPath });
			}

			await mkdir(dirname(targetPath), { recursive: true });
			const tempWritePath = resolve(tempRoot, `write-${crypto.randomUUID()}`);
			await Bun.write(tempWritePath, content);
			await rename(tempWritePath, targetPath);

			if (!existed) {
				createdFiles.add(targetPath);
			}
		}

		for (const deletePath of stagedDeletes) {
			if (!(await pathExists(deletePath))) {
				continue;
			}

			const backupPath = resolve(tempRoot, `backup-${backups.length}`);
			await rename(deletePath, backupPath);
			backups.push({ originalPath: deletePath, backupPath });
		}

		for (const backup of backups) {
			await rm(backup.backupPath, { force: true });
		}

		await rm(tempRoot, { recursive: true, force: true });
		return ok(summary);
	} catch (error) {
		for (const createdPath of createdFiles) {
			await rm(createdPath, { force: true }).catch(() => undefined);
		}

		for (let index = backups.length - 1; index >= 0; index -= 1) {
			const backup = backups[index];
			if (await pathExists(backup.originalPath)) {
				await rm(backup.originalPath, { force: true }).catch(() => undefined);
			}

			if (await pathExists(backup.backupPath)) {
				await mkdir(dirname(backup.originalPath), { recursive: true }).catch(() => undefined);
				await rename(backup.backupPath, backup.originalPath).catch(() => undefined);
			}
		}

		await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);

		return err(
			toError(
				'TOOL_EXECUTION_FAILED',
				`Failed to apply patch atomically: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}
}
