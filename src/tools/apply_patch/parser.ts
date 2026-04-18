export type PatchOperation = AddFileOperation | UpdateFileOperation | DeleteFileOperation;

export interface AddFileOperation {
	type: 'add';
	path: string;
	content: string;
}

export interface UpdateFileOperation {
	type: 'update';
	path: string;
	hunks: PatchHunk[];
	moveTo?: string;
}

export interface DeleteFileOperation {
	type: 'delete';
	path: string;
	moveTo?: string;
}

export interface PatchHunk {
	lines: PatchLine[];
}

export interface PatchLine {
	type: 'context' | 'add' | 'remove';
	text: string;
}

export class PatchParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PatchParseError';
	}
}

const BEGIN_PATCH_MARKER = '*** Begin Patch';
const END_PATCH_MARKER = '*** End Patch';
const ADD_FILE_MARKER = '*** Add File: ';
const UPDATE_FILE_MARKER = '*** Update File: ';
const DELETE_FILE_MARKER = '*** Delete File: ';
const MOVE_TO_MARKER = '*** Move to: ';
const HUNK_MARKER = '@@';

function isFileOperationMarker(line: string): boolean {
	return (
		line.startsWith(ADD_FILE_MARKER) ||
		line.startsWith(UPDATE_FILE_MARKER) ||
		line.startsWith(DELETE_FILE_MARKER)
	);
}

function normalizeLine(line: string): string {
	return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function extractPath(line: string, marker: string): string {
	const path = line.slice(marker.length).trim();
	if (path.length === 0) {
		throw new PatchParseError(`Missing path for marker: ${marker.trim()}`);
	}
	return path;
}

function parseAddFile(lines: string[], startIndex: number): { operation: AddFileOperation; nextIndex: number } {
	const path = extractPath(lines[startIndex], ADD_FILE_MARKER);
	const contentLines: string[] = [];

	let index = startIndex + 1;
	while (index < lines.length && !isFileOperationMarker(lines[index]) && lines[index] !== END_PATCH_MARKER) {
		const line = lines[index];
		if (!line.startsWith('+')) {
			throw new PatchParseError(`Invalid add-file content at line ${index + 1}: expected '+' prefix`);
		}
		contentLines.push(line.slice(1));
		index += 1;
	}

	return {
		operation: {
			type: 'add',
			path,
			content: contentLines.join('\n'),
		},
		nextIndex: index,
	};
}

function parseDeleteFile(lines: string[], startIndex: number): { operation: DeleteFileOperation; nextIndex: number } {
	const path = extractPath(lines[startIndex], DELETE_FILE_MARKER);
	let index = startIndex + 1;
	let moveTo: string | undefined;

	if (index < lines.length && lines[index].startsWith(MOVE_TO_MARKER)) {
		moveTo = extractPath(lines[index], MOVE_TO_MARKER);
		index += 1;
	}

	if (index < lines.length && !isFileOperationMarker(lines[index]) && lines[index] !== END_PATCH_MARKER) {
		throw new PatchParseError(`Unexpected delete-file content at line ${index + 1}`);
	}

	return {
		operation: {
			type: 'delete',
			path,
			moveTo,
		},
		nextIndex: index,
	};
}

function parseUpdateFile(lines: string[], startIndex: number): { operation: UpdateFileOperation; nextIndex: number } {
	const path = extractPath(lines[startIndex], UPDATE_FILE_MARKER);
	let index = startIndex + 1;
	let moveTo: string | undefined;

	if (index < lines.length && lines[index].startsWith(MOVE_TO_MARKER)) {
		moveTo = extractPath(lines[index], MOVE_TO_MARKER);
		index += 1;
	}

	const hunks: PatchHunk[] = [];

	while (index < lines.length && !isFileOperationMarker(lines[index]) && lines[index] !== END_PATCH_MARKER) {
		if (lines[index] !== HUNK_MARKER) {
			throw new PatchParseError(`Expected hunk marker '@@' at line ${index + 1}`);
		}
		index += 1;

		const hunkLines: PatchLine[] = [];
		while (
			index < lines.length &&
			!isFileOperationMarker(lines[index]) &&
			lines[index] !== END_PATCH_MARKER &&
			lines[index] !== HUNK_MARKER
		) {
			const rawLine = lines[index];
			if (rawLine.length === 0) {
				throw new PatchParseError(
					`Invalid hunk line at ${index + 1}: each hunk line must start with ' ', '+', or '-'`,
				);
			}

			const prefix = rawLine[0];
			const text = rawLine.slice(1);

			if (prefix === ' ') {
				hunkLines.push({ type: 'context', text });
			} else if (prefix === '+') {
				hunkLines.push({ type: 'add', text });
			} else if (prefix === '-') {
				hunkLines.push({ type: 'remove', text });
			} else {
				throw new PatchParseError(
					`Invalid hunk line prefix '${prefix}' at line ${index + 1}: expected ' ', '+', or '-'`,
				);
			}

			index += 1;
		}

		if (hunkLines.length === 0) {
			throw new PatchParseError(`Empty hunk at line ${index + 1}`);
		}

		hunks.push({ lines: hunkLines });
	}

	if (hunks.length === 0 && !moveTo) {
		throw new PatchParseError('Update operation must include at least one hunk or a move destination');
	}

	return {
		operation: {
			type: 'update',
			path,
			hunks,
			moveTo,
		},
		nextIndex: index,
	};
}

export function parsePatchText(patchText: string): PatchOperation[] {
	if (patchText.trim().length === 0) {
		throw new PatchParseError('Patch text is empty');
	}

	const lines = patchText.split('\n').map(normalizeLine);
	const operations: PatchOperation[] = [];

	let index = 0;
	while (index < lines.length) {
		const line = lines[index];

		if (line.length === 0 || line === BEGIN_PATCH_MARKER) {
			index += 1;
			continue;
		}

		if (line === END_PATCH_MARKER) {
			break;
		}

		if (line.startsWith(ADD_FILE_MARKER)) {
			const parsed = parseAddFile(lines, index);
			operations.push(parsed.operation);
			index = parsed.nextIndex;
			continue;
		}

		if (line.startsWith(UPDATE_FILE_MARKER)) {
			const parsed = parseUpdateFile(lines, index);
			operations.push(parsed.operation);
			index = parsed.nextIndex;
			continue;
		}

		if (line.startsWith(DELETE_FILE_MARKER)) {
			const parsed = parseDeleteFile(lines, index);
			operations.push(parsed.operation);
			index = parsed.nextIndex;
			continue;
		}

		throw new PatchParseError(`Unexpected line ${index + 1}: ${line}`);
	}

	if (operations.length === 0) {
		throw new PatchParseError('No patch operations found');
	}

	return operations;
}
