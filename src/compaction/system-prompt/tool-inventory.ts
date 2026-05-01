import type { ToolDefinition } from '../../types/tools.ts';

/** Source interface consumed by the inventory builder. */
export interface ToolInventorySource {
	getAll(): ToolDefinition[];
}

/** Stable category ordering for the inventory section. */
const CATEGORY_ORDER: Record<string, number> = {
	workflow: 0,
	interactive: 1,
	filesystem: 2,
	provider: 3,
	other: 4,
};

/**
 * Infer a tool's category from its name.
 * An explicit `tool.category` field takes precedence at the call site.
 */
export function inferCategory(name: string): string {
	if (name.startsWith('wf_')) return 'workflow';
	if (name === 'question' || name === 'slider') return 'interactive';
	if (
		name === 'read' ||
		name === 'write' ||
		name === 'edit' ||
		name === 'glob' ||
		name === 'grep' ||
		name === 'bash' ||
		name === 'apply_patch'
	) {
		return 'filesystem';
	}
	if (name === 'webfetch' || name === 'websearch') return 'provider';
	return 'other';
}

/** Human-readable category label for section headings. */
function categoryLabel(cat: string): string {
	const labels: Record<string, string> = {
		workflow: 'Workflow',
		interactive: 'Interactive',
		filesystem: 'Filesystem',
		provider: 'Provider',
		other: 'Other',
	};
	return labels[cat] ?? cat;
}

/**
 * Generate a categorized tool inventory section for the system prompt.
 * Uses bold name + em-dash format, grouped by category with stable ordering.
 */
export function buildToolInventorySection(source: ToolInventorySource): string {
	const tools = source.getAll();
	if (tools.length === 0) {
		return ['## Available Tools', '- No tools are currently registered.'].join('\n');
	}

	// Group by category
	const groups = new Map<string, ToolDefinition[]>();
	for (const tool of tools) {
		const cat = tool.category ?? inferCategory(tool.name);
		const group = groups.get(cat);
		if (group) {
			group.push(tool);
		} else {
			groups.set(cat, [tool]);
		}
	}

	// Sort categories by stable order
	const sortedCats = [...groups.keys()].sort(
		(a, b) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99),
	);

	const lines: string[] = ['## Available Tools'];

	for (const cat of sortedCats) {
		const items = groups.get(cat)!;
		// Sort alphabetically within category
		items.sort((a, b) => a.name.localeCompare(b.name));

		lines.push('');
		lines.push(`### ${categoryLabel(cat)}`);
		for (const tool of items) {
			lines.push(`- **${tool.name}** — ${tool.description}`);
		}
	}

	// Trim leading blank line after header
	if (lines[1] === '') lines.splice(1, 1);

	return lines.join('\n');
}
