import { describe, expect, it } from 'bun:test';

import { SpecTool } from './base.ts';
import { createSpecTools, instantiateSpecTools, toToolDefinition } from './index.ts';

describe('spec tool lint', () => {
	it('all 11 tools extend SpecTool and declare structural metadata', () => {
		const tools = instantiateSpecTools();
		expect(tools).toHaveLength(11);
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			'spec_adl',
			'spec_blueprint',
			'spec_checkpoint',
			'spec_chronicle',
			'spec_reference',
			'spec_requirements',
			'spec_skill',
			'spec_spec',
			'spec_state',
			'spec_status',
			'spec_workflow',
		]);

		for (const tool of tools) {
			expect(tool).toBeInstanceOf(SpecTool);
			expect(tool.name.startsWith('spec_')).toBe(true);
			expect(tool.description.length).toBeGreaterThan(10);
			expect(tool.schema).toBeDefined();
			expect(Array.isArray(tool.allowedPhases)).toBe(true);
			expect(tool.permissions).toEqual({
				read: expect.any(Boolean),
				write: expect.any(Boolean),
				execute: expect.any(Boolean),
			});
		}
	});

	it('every documented example payload parses against its tool schema', () => {
		for (const tool of instantiateSpecTools()) {
			for (const example of tool.examples) {
				const parsed = tool.schema.safeParse(example.payload);
				expect(parsed.success, `${tool.name} example ${example.name}`).toBe(true);
			}
		}
	});

	it('createSpecTools registers all spec tool definitions', () => {
		const ctx = {
			database: {} as never,
			stateManager: {} as never,
			projectId: 'project-1',
			workflowId: 'spec-mode',
		};
		const definitions = createSpecTools(ctx);
		expect(definitions).toHaveLength(11);
		for (const definition of definitions) {
			expect(definition.name.startsWith('spec_')).toBe(true);
			expect(definition.execute).toBeFunction();
		}
		const first = instantiateSpecTools()[0];
		expect(toToolDefinition(first, ctx).name).toBe(first.name);
	});
});
