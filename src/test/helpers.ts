import type { ElefantConfig } from '../config/schema.ts'
import type { ProviderAdapter, SendMessageOptions, StreamEvent } from '../providers/types.ts'

export function createMockAdapter(events: StreamEvent[]): ProviderAdapter {
	return {
		name: 'mock-provider',
		async *sendMessage(
			_messages,
			_tools,
			_options?: SendMessageOptions,
		): AsyncGenerator<StreamEvent> {
			for (const event of events) {
				yield event
			}
		},
	}
}

export function createMockConfig(): ElefantConfig {
	return {
		port: 1337,
		logLevel: 'info',
		defaultProvider: 'mock-provider',
		providers: [
			{
				name: 'mock-provider',
				baseURL: 'https://api.openai.com/v1',
				apiKey: 'test-api-key',
				model: 'gpt-4o-mini',
				format: 'openai',
			},
		],
		mcp: [],
		tokenBudgetPercent: 10,
	}
}
