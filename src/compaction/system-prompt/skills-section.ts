import { pathToFileURL } from 'node:url';

import type { SkillInfo } from '../../tools/skill/resolver.js';

const DEFAULT_MAX_CHARS = 4000;

const VERBOSE_HEADER = [
	'## Available Skills',
	'',
	'Skills provide specialized instructions and workflows for specific tasks.',
	'Use the skill tool to load a skill when a task matches its description.',
	'',
	'<available_skills>',
].join('\n');

const COMPACT_HEADER = '## Available Skills';

export interface SkillSectionOptions {
	/** @default false - compact mode is default for deferred loading */
	verbose?: boolean;
	maxChars?: number;
}

export function formatSkills(
	skills: SkillInfo[],
	opts: SkillSectionOptions = {},
): string {
	if (skills.length === 0) return '';

	const sortedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name));
	const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
	const isVerbose = opts.verbose ?? false;

	return isVerbose
		? formatVerboseSkills(sortedSkills, maxChars)
		: formatCompactSkills(sortedSkills, maxChars);
}

function formatVerboseSkills(skills: SkillInfo[], maxChars: number): string {
	const entries = skills.map(formatVerboseSkill);
	const fullOutput = [VERBOSE_HEADER, ...entries, '</available_skills>'].join('\n');

	if (fullOutput.length <= maxChars) return fullOutput;

	const keptEntries: string[] = [];
	for (const entry of entries) {
		const remaining = skills.length - keptEntries.length - 1;
		const truncationFooter = verboseTruncationFooter(remaining);
		const candidate = [VERBOSE_HEADER, ...keptEntries, entry, truncationFooter].join(
			'\n',
		);

		if (candidate.length > maxChars) break;
		keptEntries.push(entry);
	}

	const truncatedCount = skills.length - keptEntries.length;
	return [VERBOSE_HEADER, ...keptEntries, verboseTruncationFooter(truncatedCount)].join(
		'\n',
	);
}

function formatCompactSkills(skills: SkillInfo[], maxChars: number): string {
	const lines = skills.map(formatCompactSkill);
	const fullOutput = [COMPACT_HEADER, ...lines].join('\n');

	if (fullOutput.length <= maxChars) return fullOutput;

	const keptLines: string[] = [];
	for (const line of lines) {
		const remaining = skills.length - keptLines.length - 1;
		const truncationLine = compactTruncationLine(remaining);
		const candidate = [COMPACT_HEADER, ...keptLines, line, truncationLine].join(
			'\n',
		);

		if (candidate.length > maxChars) break;
		keptLines.push(line);
	}

	const truncatedCount = skills.length - keptLines.length;
	return [COMPACT_HEADER, ...keptLines, compactTruncationLine(truncatedCount)].join(
		'\n',
	);
}

function formatVerboseSkill(skill: SkillInfo): string {
	return [
		'  <skill>',
		`    <name>${escapeXml(skill.name)}</name>`,
		`    <description>${escapeXml(oneLine(skill.description))}</description>`,
		`    <location>${escapeXml(pathToFileURL(skill.path).href)}</location>`,
		'  </skill>',
	].join('\n');
}

function formatCompactSkill(skill: SkillInfo): string {
	const description = oneLine(skill.description);
	return `- **${skill.name}**: ${description} (call skill('${skill.name}') to load full content)`;
}

function verboseTruncationFooter(truncatedCount: number): string {
	return `  <!-- ${truncatedCount} more skills truncated -->\n</available_skills>`;
}

function compactTruncationLine(truncatedCount: number): string {
	return `- ... [${truncatedCount} more skills truncated]`;
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
