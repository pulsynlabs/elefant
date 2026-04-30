/**
 * A single model entry within a provider's model list.
 * Sourced from models.dev providers/<id>/models/*.toml
 */
export interface RegistryModel {
	/** Model identifier (TOML filename without .toml extension, e.g. "claude-opus-4-7") */
	id: string;
	/** Human-readable model name (from TOML 'name' field) */
	name: string;
}

/**
 * A provider entry in the bundled registry.
 * Generated at build time from .references/models.dev-dev/providers/ TOML data.
 */
export interface RegistryProvider {
	/** Provider identifier (directory name in models.dev, e.g. "anthropic", "groq") */
	id: string;
	/** Human-readable provider name (from provider.toml 'name' field) */
	name: string;
	/**
	 * Provider API base URL.
	 * For OpenAI-compatible providers: from 'api' field or supplement map.
	 * For Anthropic-compatible: from supplement map.
	 */
	baseURL: string;
	/**
	 * API wire format.
	 * 'openai' = OpenAI chat completions API;
	 * 'anthropic-compatible' = Anthropic Messages API
	 */
	format: 'openai' | 'anthropic-compatible';
	/** Environment variable names for the API key (from provider.toml 'env' field) */
	envVar: string[];
	/** Inline SVG content for the provider logo. Empty string if not bundled. */
	iconSvg: string;
	/** Link to provider documentation (from provider.toml 'doc' field) */
	docUrl: string;
	/** Known models for this provider */
	models: RegistryModel[];
}
