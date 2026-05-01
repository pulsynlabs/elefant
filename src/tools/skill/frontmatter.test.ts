/**
 * Frontmatter parser tests — YAML frontmatter extraction for SKILL.md files.
 */

import { describe, it, expect } from 'bun:test';
import { parseFrontmatter } from './frontmatter.js';

describe('parseFrontmatter', () => {
	// --- No frontmatter cases ---

	it('returns raw: null when content has no frontmatter delimiter', () => {
		const result = parseFrontmatter('# Just a markdown heading\n\nSome content.');

		expect(result.raw).toBeNull();
		expect(result.description).toBeUndefined();
	});

	it('returns raw: null for an empty string', () => {
		const result = parseFrontmatter('');

		expect(result.raw).toBeNull();
		expect(result.description).toBeUndefined();
	});

	it('returns raw: null when content starts with --- but no newline after', () => {
		const result = parseFrontmatter('---not-frontmatter\nkey: val\n---\nbody');

		expect(result.raw).toBeNull();
		expect(result.description).toBeUndefined();
	});

	// --- Malformed frontmatter ---

	it('returns raw: null when closing --- delimiter is missing', () => {
		const content = '---\nkey: value\ndescription: My skill\nbody without closing';
		const result = parseFrontmatter(content);

		expect(result.raw).toBeNull();
		expect(result.description).toBeUndefined();
	});

	// --- Frontmatter without description ---

	it('returns other keys in raw when description field is absent', () => {
		const content = [
			'---',
			'name: my-skill',
			'author: Alice',
			'---',
			'',
			'# Skill Body',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.raw).not.toBeNull();
		expect(result.raw!).toEqual({ name: 'my-skill', author: 'Alice' });
		expect(result.description).toBeUndefined();
	});

	// --- Plain description ---

	it('extracts a plain description value (no quotes)', () => {
		const content = [
			'---',
			'description: My simple skill',
			'---',
			'',
			'Body text.',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.raw).not.toBeNull();
		expect(result.description).toBe('My simple skill');
		expect(result.raw!.description).toBe('My simple skill');
	});

	// --- Double-quoted description ---

	it('strips double quotes from the description value', () => {
		const content = [
			'---',
			'description: "My quoted skill"',
			'---',
			'',
			'Body.',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.description).toBe('My quoted skill');
	});

	// --- Single-quoted description ---

	it('strips single quotes from the description value', () => {
		const content = [
			'---',
			"description: 'My single-quoted skill'",
			'---',
			'',
			'Body.',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.description).toBe('My single-quoted skill');
	});

	// --- Colon embedded in value ---

	it('preserves a colon inside the description value', () => {
		const content = [
			'---',
			'description: value with: colon inside',
			'---',
			'',
			'Body.',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.description).toBe('value with: colon inside');
	});

	// --- Backticks in value ---

	it('passes backticks through unchanged', () => {
		const content = [
			'---',
			'description: value with backticks `here` and more',
			'---',
			'',
			'Body.',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.description).toBe('value with backticks `here` and more');
	});

	// --- Whitespace collapsing ---

	it('collapses internal whitespace to a single space', () => {
		const content = [
			'---',
			'description:    too   many    spaces   ',
			'---',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.description).toBe('too many spaces');
	});

	// --- Windows line endings (CRLF) ---

	it('handles Windows-style \\r\\n line endings', () => {
		const content = '---\r\ndescription: windows skill\r\n---\r\nbody';

		const result = parseFrontmatter(content);

		expect(result.raw).not.toBeNull();
		expect(result.description).toBe('windows skill');
	});

	// --- Empty frontmatter between delimiters ---

	it('returns empty raw object when frontmatter has no key-value pairs', () => {
		const content = ['---', '', '---', '', 'body'].join('\n');

		const result = parseFrontmatter(content);

		expect(result.raw).toEqual({});
		expect(result.description).toBeUndefined();
	});

	// --- Comment lines in frontmatter ---

	it('skips YAML comment lines (starting with #) in frontmatter', () => {
		const content = [
			'---',
			'# This is a comment',
			'description: my skill',
			'# Another comment',
			'---',
			'',
			'body',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.description).toBe('my skill');
		expect(Object.keys(result.raw!)).toHaveLength(1);
	});

	// --- Leading whitespace before --- not valid ---

	it('returns raw: null when content has leading whitespace before ---', () => {
		const content = '  \n---\ndescription: skill\n---\nbody';

		const result = parseFrontmatter(content);

		expect(result.raw).toBeNull();
	});

	// --- Multiple keys including description at end ---

	it('extracts description regardless of position among other keys', () => {
		const content = [
			'---',
			'name: my-skill',
			'version: 1.0',
			'description: last-positioned description',
			'---',
			'',
			'body',
		].join('\n');

		const result = parseFrontmatter(content);

		expect(result.description).toBe('last-positioned description');
		expect(result.raw!.version).toBe('1.0');
	});

	// --- Only closing ---, no body after ---

	it('handles frontmatter at end of file with no trailing body', () => {
		const content = '---\ndescription: no body after\n---';

		const result = parseFrontmatter(content);

		expect(result.description).toBe('no body after');
	});
});
