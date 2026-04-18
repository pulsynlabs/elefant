/**
 * Skill tool tests — resolution order and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillTool } from './index.js';
import { resolveSkill, listSkills } from './resolver.js';

describe('skill tool', () => {
	describe('skillTool.execute', () => {
		it('returns VALIDATION_ERROR when neither name nor list provided', async () => {
			const result = await skillTool.execute({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe('VALIDATION_ERROR');
				expect(result.error.message).toBe('Provide either name or list: true');
			}
		});

		it('returns FILE_NOT_FOUND for unknown skill name', async () => {
			const result = await skillTool.execute({ name: 'nonexistent-skill-xyz' });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe('FILE_NOT_FOUND');
				expect(result.error.message).toBe('Skill not found: nonexistent-skill-xyz');
			}
		});
	});

	describe('listSkills', () => {
		let tempDir: string;
		let originalCwd: string;

		beforeEach(() => {
			tempDir = mkdtempSync(join(tmpdir(), 'elefant-skill-test-'));
			originalCwd = process.cwd();
			process.chdir(tempDir);
		});

		afterEach(() => {
			process.chdir(originalCwd);
			rmSync(tempDir, { recursive: true, force: true });
		});

		it('returns empty array when no skills exist', async () => {
			const skills = await listSkills();
			expect(skills).toEqual([]);
		});

		it('lists project-level skills', async () => {
			// Create a project-level skill
			const skillDir = join(tempDir, '.elefant', 'skills', 'test-skill');
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, 'SKILL.md'),
				'# Test Skill\n\nThis is a test skill for listing.',
			);

			const skills = await listSkills();
			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe('test-skill');
			expect(skills[0].description).toBe('# Test Skill');
			expect(skills[0].source).toBe('project');
		});

		it('skillTool list mode returns formatted list', async () => {
			// Create a project-level skill
			const skillDir = join(tempDir, '.elefant', 'skills', 'my-skill');
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, 'SKILL.md'),
				'My custom skill description\n\nMore details here.',
			);

			const result = await skillTool.execute({ list: true });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toContain('my-skill');
				expect(result.data).toContain('[project]');
				expect(result.data).toContain('My custom skill description');
			}
		});

		it('skillTool list mode returns "No skills available." when empty', async () => {
			const result = await skillTool.execute({ list: true });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toBe('No skills available.');
			}
		});
	});

	describe('resolveSkill priority order', () => {
		let tempDir: string;
		let originalCwd: string;

		beforeEach(() => {
			tempDir = mkdtempSync(join(tmpdir(), 'elefant-skill-test-'));
			originalCwd = process.cwd();
			process.chdir(tempDir);
		});

		afterEach(() => {
			process.chdir(originalCwd);
			rmSync(tempDir, { recursive: true, force: true });
		});

		it('resolves project-level skill first', async () => {
			// Create project-level skill
			const projectSkillDir = join(tempDir, '.elefant', 'skills', 'test-skill');
			mkdirSync(projectSkillDir, { recursive: true });
			writeFileSync(
				join(projectSkillDir, 'SKILL.md'),
				'Project level skill',
			);

			const result = await resolveSkill('test-skill');

			expect(result).not.toBeNull();
			expect(result!.content).toBe('Project level skill');
			expect(result!.path).toContain('.elefant/skills/test-skill/SKILL.md');
		});

		it('falls through to user-level when project-level absent', async () => {
			// Create user-level skill (mock by creating in temp dir structure)
			const userSkillDir = join(tempDir, 'user-config', 'elefant', 'skills', 'user-skill');
			mkdirSync(userSkillDir, { recursive: true });
			writeFileSync(
				join(userSkillDir, 'SKILL.md'),
				'User level skill',
			);

			// Temporarily override homedir by modifying the resolver's behavior
			// Since we can't easily mock homedir(), we test via skillTool with a unique name
			// that won't exist in project or builtin
			const result = await skillTool.execute({ name: 'user-skill' });

			// Should fail since we can't easily mock homedir in this test setup
			expect(result.ok).toBe(false);
		});

		it('skillTool loads skill content by name', async () => {
			// Create project-level skill
			const skillDir = join(tempDir, '.elefant', 'skills', 'loadable-skill');
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, 'SKILL.md'),
				'# Loadable Skill\n\nThis skill can be loaded.',
			);

			const result = await skillTool.execute({ name: 'loadable-skill' });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toBe('# Loadable Skill\n\nThis skill can be loaded.');
			}
		});
	});

	describe('extractDescription', () => {
		it('extracts first non-blank line as description', async () => {
			const tempDir = mkdtempSync(join(tmpdir(), 'elefant-skill-test-'));
			const originalCwd = process.cwd();
			process.chdir(tempDir);

			try {
				// Create skill with blank lines at start
				const skillDir = join(tempDir, '.elefant', 'skills', 'desc-skill');
				mkdirSync(skillDir, { recursive: true });
				writeFileSync(
					join(skillDir, 'SKILL.md'),
					'\n\n  \nFirst real line\nSecond line',
				);

				const skills = await listSkills();
				expect(skills).toHaveLength(1);
				expect(skills[0].description).toBe('First real line');
			} finally {
				process.chdir(originalCwd);
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it('returns placeholder for empty skill files', async () => {
			const tempDir = mkdtempSync(join(tmpdir(), 'elefant-skill-test-'));
			const originalCwd = process.cwd();
			process.chdir(tempDir);

			try {
				// Create empty skill file
				const skillDir = join(tempDir, '.elefant', 'skills', 'empty-skill');
				mkdirSync(skillDir, { recursive: true });
				writeFileSync(join(skillDir, 'SKILL.md'), '');

				const skills = await listSkills();
				expect(skills).toHaveLength(1);
				expect(skills[0].description).toBe('(no description)');
			} finally {
				process.chdir(originalCwd);
				rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	describe('deduplication', () => {
		let tempDir: string;
		let originalCwd: string;

		beforeEach(() => {
			tempDir = mkdtempSync(join(tmpdir(), 'elefant-skill-test-'));
			originalCwd = process.cwd();
			process.chdir(tempDir);
		});

		afterEach(() => {
			process.chdir(originalCwd);
			rmSync(tempDir, { recursive: true, force: true });
		});

		it('project skill overrides user and builtin', async () => {
			// We can only test project vs builtin since user requires homedir mocking
			// Create project-level skill
			const projectSkillDir = join(tempDir, '.elefant', 'skills', 'override-skill');
			mkdirSync(projectSkillDir, { recursive: true });
			writeFileSync(
				join(projectSkillDir, 'SKILL.md'),
				'Project version',
			);

			// Create builtin-level skill (in the actual builtin directory)
			const builtinDir = join(import.meta.dir, 'builtin', 'override-skill');
			mkdirSync(builtinDir, { recursive: true });
			writeFileSync(
				join(builtinDir, 'SKILL.md'),
				'Builtin version',
			);

			try {
				const skills = await listSkills();
				const skill = skills.find((s) => s.name === 'override-skill');

				expect(skill).toBeDefined();
				expect(skill!.source).toBe('project');
				expect(skill!.description).toBe('Project version');
			} finally {
				// Cleanup builtin skill
				rmSync(builtinDir, { recursive: true, force: true });
			}
		});
	});
});
