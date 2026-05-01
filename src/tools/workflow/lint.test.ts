import { describe, expect, it } from 'bun:test';

import { SpecTool } from './base.ts';
import { createSpecTools, instantiateSpecTools, toToolDefinition } from './index.ts';

describe('spec tool lint', () => {
	it('all 11 tools extend SpecTool and declare structural metadata', () => {
		const tools = instantiateSpecTools();
		expect(tools).toHaveLength(11);
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			'wf_adl',
			'wf_blueprint',
			'wf_checkpoint',
			'wf_chronicle',
			'wf_reference',
			'wf_requirements',
			'wf_skill',
			'wf_spec',
			'wf_state',
			'wf_status',
			'wf_workflow',
		]);

		for (const tool of tools) {
			expect(tool).toBeInstanceOf(SpecTool);
			expect(tool.name.startsWith('wf_')).toBe(true);
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
			expect(definition.name.startsWith('wf_')).toBe(true);
			expect(definition.execute).toBeFunction();
		}
		const first = instantiateSpecTools()[0];
		expect(toToolDefinition(first, ctx).name).toBe(first.name);
	});
});
