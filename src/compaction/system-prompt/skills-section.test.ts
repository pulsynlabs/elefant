import { describe, expect, test } from 'bun:test';

import type { SkillInfo } from '../../tools/skill/resolver.js';
import { formatSkills } from './skills-section.js';

function skill(overrides: Partial<SkillInfo> & Pick<SkillInfo, 'name'>): SkillInfo {
	return {
		name: overrides.name,
		description:
			overrides.description ??
			'Creative coding in p5.js — generative art and interactive visuals',
		source: overrides.source ?? 'user',
		path: overrides.path ?? `/home/user/.agents/skills/${overrides.name}/SKILL.md`,
	};
}

describe('formatSkills', () => {
	test('returns an empty string for an empty skill list', () => {
		expect(formatSkills([], { verbose: true })).toBe('');
		expect(formatSkills([], { verbose: false })).toBe('');
	});

	test('formats a single skill as verbose XML', () => {
		const output = formatSkills([skill({ name: 'p5js' })], { verbose: true });

		expect(output).toContain('<available_skills>');
		expect(output).toContain('<name>p5js</name>');
		expect(output).toContain(
			'<description>Creative coding in p5.js — generative art and interactive visuals</description>',
		);
		expect(output).toContain(
			'<location>file:///home/user/.agents/skills/p5js/SKILL.md</location>',
		);
		expect(output).toContain('</available_skills>');
	});

	test('formats a single skill as compact markdown', () => {
		const output = formatSkills([skill({ name: 'p5js' })], { verbose: false });

		expect(output).toContain('## Available Skills');
		expect(output).toContain(
			'- **p5js**: Creative coding in p5.js — generative art and interactive visuals',
		);
	});

	test('includes all skills under maxChars without a truncation note', () => {
		const output = formatSkills(
			[
				skill({ name: 'p5js', description: 'Creative coding' }),
				skill({ name: 'comfyui', description: 'Generate media' }),
				skill({ name: 'minimalist-ui', description: 'Clean interfaces' }),
			],
			{ verbose: true, maxChars: 4000 },
		);

		expect(output).toContain('<name>comfyui</name>');
		expect(output).toContain('<name>minimalist-ui</name>');
		expect(output).toContain('<name>p5js</name>');
		expect(output).not.toContain('more skills truncated');
	});

	test('truncates verbose output at whole skill entries', () => {
		const output = formatSkills(
			[
				skill({ name: 'alpha', description: 'A'.repeat(40) }),
				skill({ name: 'bravo', description: 'B'.repeat(40) }),
				skill({ name: 'charlie', description: 'C'.repeat(40) }),
				skill({ name: 'delta', description: 'D'.repeat(40) }),
			],
			{ verbose: true, maxChars: 520 },
		);

		expect(output).toContain('more skills truncated');
		expect(output).toEndWith('</available_skills>');
		expect(output).not.toContain('<name>charlie</name>');
		expect(output).not.toContain('<name>delta</name>');
		expect(output.match(/<skill>/g)?.length ?? 0).toBe(
			output.match(/<\/skill>/g)?.length ?? 0,
		);
	});

	test('truncates compact output at complete skill lines', () => {
		const output = formatSkills(
			[
				skill({ name: 'alpha', description: 'A'.repeat(30) }),
				skill({ name: 'bravo', description: 'B'.repeat(30) }),
				skill({ name: 'charlie', description: 'C'.repeat(30) }),
				skill({ name: 'delta', description: 'D'.repeat(30) }),
			],
			{ verbose: false, maxChars: 135 },
		);

		expect(output).toContain('- ... [');
		expect(output).toContain('more skills truncated]');
		expect(output).not.toContain('charlie');
		expect(output).not.toContain('delta');
		expect(output.split('\n').every((line) => !line.includes('**char'))).toBe(true);
	});

	test('sorts skills alphabetically by name', () => {
		const output = formatSkills(
			[
				skill({ name: 'p5js', description: 'Creative coding' }),
				skill({ name: 'comfyui', description: 'Generate media' }),
				skill({ name: 'minimalist-ui', description: 'Clean interfaces' }),
			],
			{ verbose: false },
		);

		expect(output.indexOf('**comfyui**')).toBeLessThan(
			output.indexOf('**minimalist-ui**'),
		);
		expect(output.indexOf('**minimalist-ui**')).toBeLessThan(
			output.indexOf('**p5js**'),
		);
	});
});
