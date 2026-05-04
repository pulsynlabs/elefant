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
 * Generate a marker suffix for a tool based on its loading status.
 * - [deferred] — Tool requires tool_search to load full schema
 * - [always] — Tool is explicitly always-loaded
 * - No marker — Standard tool (always-loaded by default)
 */
function getToolMarker(tool: ToolDefinition): string {
	if (tool.deferred === true) {
		return ' [deferred]';
	}
	if (tool.alwaysLoad === true) {
		return ' [always]';
	}
	return '';
}

/**
 * Generate a categorized tool inventory section for the system prompt.
 * Uses bold name + em-dash format, grouped by category with stable ordering.
 * Deferred tools are marked with [deferred] and include a hint to use tool_search.
 */
export function buildToolInventorySection(source: ToolInventorySource): string {
	const tools = source.getAll();
	if (tools.length === 0) {
		return ['## Available Tools', '- No tools are currently registered.'].join('\n');
	}

	// Check if any tools are deferred (for instructional preamble)
	const hasDeferredTools = tools.some((t) => t.deferred === true);

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

	// Add instructional preamble if deferred tools are present
	if (hasDeferredTools) {
		lines.push('');
		lines.push('💡 Use `tool_search` to load full schemas for `[deferred]` tools before using them.');
	}

	for (const cat of sortedCats) {
		const items = groups.get(cat)!;
		// Sort alphabetically within category
		items.sort((a, b) => a.name.localeCompare(b.name));

		lines.push('');
		lines.push(`### ${categoryLabel(cat)}`);
		for (const tool of items) {
			const marker = getToolMarker(tool);
			lines.push(`- **${tool.name}**${marker} — ${tool.description}`);
		}
	}

	// Trim leading blank line after header (but keep preamble blank line)
	if (lines[1] === '' && !hasDeferredTools) lines.splice(1, 1);

	return lines.join('\n');
}
