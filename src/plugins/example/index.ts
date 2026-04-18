import type { ElefantPluginAPI } from '../api.ts';

export default function elefantExamplePlugin(api: ElefantPluginAPI): void {
	api.on('project:open', (context) => {
		api.log.info(`Project opened: ${context.projectId} at ${context.projectPath}`);
	});

	api.registerTool({
		name: 'hello',
		description: 'Returns a greeting. Example plugin tool.',
		parameters: {
			name: { type: 'string', description: 'Name to greet' },
		},
		execute: async (params) => {
			const normalized =
				typeof params === 'object' && params !== null && !Array.isArray(params)
					? (params as { name?: string })
					: {};
			const name = normalized.name ?? 'world';
			return { ok: true, data: `Hello, ${name}!` };
		},
	});

	api.registerCommand('greet', (args) => {
		api.log.info(`Greet command called with args: ${args}`);
	});

	// Example only (no real API key here):
	// api.registerProvider('example-provider', { ... });

	api.log.info('Example plugin loaded successfully');
}
