import { PROVIDER_REGISTRY } from './generated.ts';
import type { RegistryProvider } from './types.ts';

export type { RegistryProvider, RegistryModel } from './types.ts';

/**
 * Returns the full bundled provider registry.
 * Generated at build time from models.dev TOML data.
 */
export function getProviderRegistry(): readonly RegistryProvider[] {
	return PROVIDER_REGISTRY;
}

/**
 * Returns a single provider by its registry ID, or undefined if not found.
 * @param id - Provider ID (e.g., "anthropic", "groq", "mistral")
 */
export function getProvider(id: string): RegistryProvider | undefined {
	return PROVIDER_REGISTRY.find((p) => p.id === id);
}
