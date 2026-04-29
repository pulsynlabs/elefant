// Spec Mode → memory bridge
//
// Helpers that distill spec-mode lifecycle moments into `memory_entries` rows
// using the existing repo (no MCP round-trip). Used by hook handlers that need
// to persist context for future workflows on the same project.
//
// All functions here are best-effort: if the memory tables are missing or the
// insert fails, callers should swallow the error rather than propagating it.

import type { Database } from '../db/database.ts';
import { insertMemoryEntry } from '../db/repo/memory.ts';

export interface DiscoveryRequirements {
	vision?: string;
	mustHaves?: Array<{ mhId?: string; title?: string } | string>;
	outOfScope?: string[];
	risks?: Array<{ title?: string } | string>;
}

/**
 * Persist a "Discovery: <workflowId>" memory note when the discuss phase
 * completes. Pulls vision + must-have titles + risks into a single observation
 * tagged with `["spec-mode", workflowId, "discovery"]` so planner.memory_search
 * surfaces it in subsequent workflows.
 *
 * Returns the inserted memory entry id (or null on failure / empty payload).
 * Never throws — memory is best-effort.
 */
export async function onDiscoveryComplete(
	workflowId: string,
	requirements: DiscoveryRequirements,
	database: Database,
): Promise<number | null> {
	const lines: string[] = [];
	if (requirements.vision) {
		lines.push(`Vision: ${requirements.vision}`);
	}

	const mhTitles = (requirements.mustHaves ?? [])
		.map((mh) => (typeof mh === 'string' ? mh : `${mh.mhId ?? ''} ${mh.title ?? ''}`.trim()))
		.filter((title) => title.length > 0);
	if (mhTitles.length > 0) {
		lines.push(`Must-haves: ${mhTitles.join('; ')}`);
	}

	if (requirements.outOfScope && requirements.outOfScope.length > 0) {
		lines.push(`Out of scope: ${requirements.outOfScope.join('; ')}`);
	}

	const riskTitles = (requirements.risks ?? [])
		.map((r) => (typeof r === 'string' ? r : r.title ?? ''))
		.filter((title) => title.length > 0);
	if (riskTitles.length > 0) {
		lines.push(`Risks: ${riskTitles.join('; ')}`);
	}

	const content = lines.join('\n');
	if (content.trim().length === 0) {
		// Nothing meaningful to record — skip the write.
		return null;
	}

	try {
		const result = insertMemoryEntry(database, {
			type: 'note',
			title: `Discovery: ${workflowId}`,
			content,
			importance: 7,
			concepts: JSON.stringify(['spec-mode', workflowId, 'discovery']),
			source_files: '[]',
		});
		if (!result.ok) return null;
		return result.data.id;
	} catch {
		return null;
	}
}
