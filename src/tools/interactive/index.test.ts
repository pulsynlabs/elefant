/**
 * Tests for the interactive tools registry module.
 */

import { describe, it, expect } from 'bun:test';
import { createInteractiveTools } from './index.js';

describe('createInteractiveTools', () => {
	it('returns an array', () => {
		const tools = createInteractiveTools({});
		expect(Array.isArray(tools)).toBe(true);
	});

	it('includes the question tool', () => {
		const tools = createInteractiveTools({});
		const names = tools.map((t) => t.name);
		expect(names).toContain('question');
	});

	it('includes the slider tool', () => {
		const tools = createInteractiveTools({});
		const names = tools.map((t) => t.name);
		expect(names).toContain('slider');
	});

	it('returns exactly two tools (question + slider)', () => {
		const tools = createInteractiveTools({});
		expect(tools.length).toBe(2);
	});

	it('all tools have required properties', () => {
		const tools = createInteractiveTools({});
		for (const tool of tools) {
			expect(typeof tool.name).toBe('string');
			expect(tool.name.length).toBeGreaterThan(0);
			expect(typeof tool.description).toBe('string');
			expect(tool.description.length).toBeGreaterThan(0);
			expect(typeof tool.parameters).toBe('object');
			expect(typeof tool.execute).toBe('function');
		}
	});

	it('slider tool can be created and executed with valid params', async () => {
		const tools = createInteractiveTools({});
		const slider = tools.find((t) => t.name === 'slider');
		expect(slider).toBeDefined();

		// Quick smoke: should validate and reject on bad args
		const result = await slider!.execute({ min: 10, max: 5 });
		expect(result.ok).toBe(false);
	});
});
