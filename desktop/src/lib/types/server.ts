// Server configuration types for multi-daemon connection management.
// These define the canonical data model for server connections.

/**
 * Credentials for HTTP Basic Authentication to a daemon server.
 * Optional on ServerConfig — only provided when the server requires auth.
 */
export interface ServerCredentials {
	username: string;
	password: string;
}

/**
 * Health status of a server connection as tracked by the registry.
 *
 * - `connected`    — Health check succeeded recently
 * - `reconnecting` — Health check failed, retrying with backoff
 * - `disconnected` — Health check failed, retries exhausted
 * - `unknown`      — No health check performed yet (initial state)
 */
export type ServerHealthStatus = 'connected' | 'reconnecting' | 'disconnected' | 'unknown';

/**
 * Configuration for a single daemon server connection.
 *
 * This is the canonical data model for multi-daemon support. Each server
 * has a stable ID, normalized URL, optional credentials, and flags for
 * default/active state and locality.
 *
 * The `id` is a stable UUID generated at creation time and never changes.
 * The `url` is normalized (http(s):// prefix, no trailing slash).
 * Exactly one server in the list should have `isDefault: true`.
 */
export interface ServerConfig {
	/** Stable UUID generated at creation time */
	id: string;

	/** Normalized daemon URL (http(s)://, no trailing slash) */
	url: string;

	/** User-provided display name or hostname fallback */
	displayName: string;

	/** Optional HTTP Basic Auth credentials */
	credentials?: ServerCredentials;

	/** True if this is the default server (exactly one should be default) */
	isDefault: boolean;

	/** True for localhost/127.0.0.1; false for remote VPS */
	isLocal: boolean;
}

/**
 * Default seed values for creating the initial local server on fresh install.
 *
 * This constant provides the base values for the default local server.
 * The `id` and `credentials` are added at creation time.
 *
 * Usage:
 * ```ts
 * const defaultServer: ServerConfig = {
 *   ...DEFAULT_LOCAL_SERVER_SEED,
 *   id: generateId(),
 * };
 * ```
 */
export const DEFAULT_LOCAL_SERVER_SEED = {
	url: 'http://localhost:1337',
	displayName: 'Local',
	isLocal: true,
	isDefault: true,
} as const;
