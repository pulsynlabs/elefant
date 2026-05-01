// optimize-prompt — unit tests.
//
// Locks in the short-circuit boundary, the structural framing,
// the heuristic enrichment branches, and idempotency. Heuristic order
// (UI > Backend > Bug) is intentional: a UI bug should still be framed
// as a UI task because that's where the design constraints live.

import { describe, expect, it } from 'bun:test';
import { optimizePrompt } from './optimize-prompt.js';

describe('optimizePrompt', () => {
	it('returns text unchanged when shorter than 20 chars', async () => {
		const input = 'short text';
		expect(await optimizePrompt(input)).toBe(input);
	});

	it('returns text unchanged for empty string', async () => {
		expect(await optimizePrompt('')).toBe('');
	});

	it('returns text unchanged for whitespace-only string under threshold', async () => {
		const input = '   \n  ';
		expect(await optimizePrompt(input)).toBe(input);
	});

	it('returns text unchanged at exactly 19 chars (just below threshold)', async () => {
		const input = 'a'.repeat(19);
		expect(await optimizePrompt(input)).toBe(input);
	});

	it('adds goal framing for a normal text', async () => {
		const input = 'Build a markdown editor with live preview support';
		const result = await optimizePrompt(input);

		expect(result).toContain('You are a senior software architect and product engineer.');
		expect(result).toContain('## Goal');
		expect(result).toContain(input);
		expect(result).toContain("## What I'm asking for");
		expect(result).toContain('## Context');
		expect(result).toContain('spec first, then plan, then implement');
	});

	it('adds UI framing hint for UI-related text', async () => {
		const input = 'Add a dark mode toggle to the settings page';
		const result = await optimizePrompt(input);

		expect(result).toContain(
			'This appears to be a UI task. Consider accessibility, responsive design, and existing design system patterns.',
		);
		expect(result).not.toContain('This appears to be a backend task');
		expect(result).not.toContain('This appears to be a bug fix');
	});

	it('detects UI keywords case-insensitively', async () => {
		const input = 'Refactor the LOGIN MODAL for better accessibility';
		const result = await optimizePrompt(input);
		expect(result).toContain('This appears to be a UI task');
	});

	it('adds backend framing hint for backend-related text', async () => {
		const input = 'Design a REST API endpoint for user profile updates';
		const result = await optimizePrompt(input);

		expect(result).toContain(
			'This appears to be a backend task. Consider security, error handling, and data validation.',
		);
		expect(result).not.toContain('This appears to be a UI task');
		expect(result).not.toContain('This appears to be a bug fix');
	});

	it('adds backend framing for database-related text', async () => {
		const input = 'Migrate the users database to use UUIDs instead of integers';
		const result = await optimizePrompt(input);
		expect(result).toContain('This appears to be a backend task');
	});

	it('adds bug fix framing for bug-related text', async () => {
		const input = 'Fix the broken authentication flow that logs users out randomly';
		const result = await optimizePrompt(input);

		expect(result).toContain(
			'This appears to be a bug fix. Consider root cause analysis before patching.',
		);
		expect(result).not.toContain('This appears to be a UI task');
		expect(result).not.toContain('This appears to be a backend task');
	});

	it('adds no heuristic framing when no keywords match', async () => {
		const input = 'Write documentation about our deployment philosophy and rollout cadence';
		const result = await optimizePrompt(input);

		expect(result).not.toContain('This appears to be a UI task');
		expect(result).not.toContain('This appears to be a backend task');
		expect(result).not.toContain('This appears to be a bug fix');
		expect(result).toContain('## Goal');
	});

	it('prioritises UI framing when UI and bug keywords both appear', async () => {
		const input = 'Fix the broken modal close button on the settings page';
		const result = await optimizePrompt(input);

		expect(result).toContain('This appears to be a UI task');
		expect(result).not.toContain('This appears to be a bug fix');
	});

	it('is idempotent (calling twice gives same result)', async () => {
		const input = 'Add a dark mode toggle to the settings page';
		const once = await optimizePrompt(input);
		const twice = await optimizePrompt(once);
		expect(twice).toBe(once);
	});

	it('normalizes whitespace by collapsing 3+ blank lines to one', async () => {
		const input = 'Build a chat interface\n\n\n\n\nwith streaming support';
		const result = await optimizePrompt(input);

		expect(result).toContain('Build a chat interface\n\nwith streaming support');
		expect(result).not.toContain('\n\n\n');
	});

	it('normalizes whitespace by trimming leading and trailing space', async () => {
		const input = '   \n\n  Build a chat interface with streaming  \n\n   ';
		const result = await optimizePrompt(input);

		expect(result).toContain('## Goal\nBuild a chat interface with streaming\n');
	});

	it('preserves single blank lines as paragraph breaks', async () => {
		const input = 'First paragraph describing the work.\n\nSecond paragraph with more detail.';
		const result = await optimizePrompt(input);

		expect(result).toContain(
			'First paragraph describing the work.\n\nSecond paragraph with more detail.',
		);
	});

	it('avoids substring false positives via word boundaries', async () => {
		// "rebuttal" contains "butt" but should not match "button" keyword.
		// "errored" contains "error" — that one IS expected to match because
		// "error" is the documented keyword and "errored" reads as bug-adjacent.
		// We only assert the negative case here.
		const input =
			'Improve the rebuttal letter generation pipeline for legal review workflows';
		const result = await optimizePrompt(input);
		expect(result).not.toContain('This appears to be a UI task');
	});
});
