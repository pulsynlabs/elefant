/**
 * YAML frontmatter parser for SKILL.md files.
 *
 * Extracts the `description` field from `---`-delimited
 * frontmatter blocks. No dependencies — hand-rolled.
 */

export interface FrontmatterResult {
	description?: string;
	raw: Record<string, string> | null; // null when no frontmatter present
}

/**
 * Parse a simple YAML frontmatter block from a markdown string.
 *
 * Only handles flat `key: value` pairs — no nested objects or arrays.
 * The frontmatter block must begin at the very start of the string
 * and be delimited by `---` on its own line:
 *
 * ```
 * ---
 * key: value
 * description: My skill
 * ---
 * Rest of the markdown...
 * ```
 */
export function parseFrontmatter(content: string): FrontmatterResult {
	// Guard: content must start with --- followed by newline
	const delimiterLen = content.startsWith('---\r\n') ? 5 : content.startsWith('---\n') ? 4 : -1;
	if (delimiterLen === -1) {
		return { raw: null };
	}

	const afterOpen = content.slice(delimiterLen);

	// Split remaning content into lines and find the closing ---
	const lines = afterOpen.split(/\r?\n/);

	let closeLineIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === '---') {
			closeLineIndex = i;
			break;
		}
	}

	if (closeLineIndex === -1) {
		return { raw: null };
	}

	// Parse the key-value lines between the delimiters
	const fmLines = lines.slice(0, closeLineIndex);
	const raw: Record<string, string> = {};

	for (const line of fmLines) {
		const trimmed = line.trim();
		if (trimmed === '' || trimmed.startsWith('#')) continue;

		const colonIndex = trimmed.indexOf(':');
		if (colonIndex === -1) continue;

		const key = trimmed.slice(0, colonIndex).trim();
		let value = trimmed.slice(colonIndex + 1).trim();

		// Strip surrounding quotes (single or double)
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		// Collapse internal whitespace to a single space
		value = value.replace(/\s+/g, ' ');

		raw[key] = value;
	}

	return {
		description: 'description' in raw ? raw.description : undefined,
		raw,
	};
}
