import type { ElefantConfig } from '../config/schema.ts'
import type { ElefantError } from '../types/errors.ts'
import type { Result } from '../types/result.ts'
import { err, ok } from '../types/result.ts'
import type { ProviderAdapter } from './types.ts'
import { AnthropicCompatibleAdapter } from './anthropic.ts'
import { OpenAIAdapter } from './openai.ts'

export class ProviderRouter {
	private readonly adapters: Map<string, ProviderAdapter>
	private defaultProvider: string

	constructor(config: ElefantConfig) {
		this.adapters = new Map<string, ProviderAdapter>()
		this.defaultProvider = config.defaultProvider

		for (const provider of config.providers) {
			if (this.adapters.has(provider.name)) {
				throw new Error(`Duplicate provider name in config: ${provider.name}`)
			}

			if (provider.format === 'openai') {
				this.adapters.set(provider.name, new OpenAIAdapter(provider))
				continue
			}

			if (provider.format === 'anthropic' || provider.format === 'anthropic-compatible') {
				this.adapters.set(provider.name, new AnthropicCompatibleAdapter(provider))
				continue
			}

			throw new Error(`Unsupported provider format: ${(provider as { format: string }).format}`)
		}

		// No providers configured yet — that's fine, user will add via the desktop UI
	}

	public reload(config: ElefantConfig): void {
		this.adapters.clear()
		for (const provider of config.providers) {
			if (provider.format === 'openai') {
				this.adapters.set(provider.name, new OpenAIAdapter(provider))
				continue
			}

			if (provider.format === 'anthropic' || provider.format === 'anthropic-compatible') {
				this.adapters.set(provider.name, new AnthropicCompatibleAdapter(provider))
				continue
			}

			throw new Error(`Unsupported provider format: ${(provider as { format: string }).format}`)
		}
		this.defaultProvider = config.defaultProvider
	}

	public getAdapter(name?: string): Result<ProviderAdapter, ElefantError> {
		if (this.adapters.size === 0) {
			return err({
				code: 'CONFIG_INVALID',
				message: 'No providers configured. Add a provider in Settings.',
				details: { availableProviders: [] },
			})
		}

		const selectedProvider = name ?? this.defaultProvider
		const adapter = this.adapters.get(selectedProvider)
			?? this.adapters.values().next().value // fallback to first if default unset

		if (!adapter) {
			return err({
				code: 'CONFIG_INVALID',
				message: `Provider not found: "${selectedProvider}". Available: ${this.listProviders().join(', ')}`,
				details: {
					requestedProvider: selectedProvider,
					availableProviders: this.listProviders(),
				},
			})
		}

		return ok(adapter)
	}

	public listProviders(): string[] {
		return Array.from(this.adapters.keys())
	}
}
