/**
 * Pure state helpers for ServeSettings.svelte.
 *
 * Extracted as standalone functions so they can be unit-tested with
 * `bun test` without needing a Svelte renderer.
 */

export type BindMode = 'localhost' | 'network' | 'tailscale';

export interface ServeStatusData {
	running: boolean;
	url: string | null;
	bindMode: string | null;
	tailscaleIp: string | null;
}

export interface AuthStatusData {
	configured: boolean;
	username: string | null;
}

export interface TailscaleData {
	detected: boolean;
	ip: string | null;
}

/**
 * Build a human-readable status label for the serve panel.
 *
 * - null  → "Loading..."  (initial fetch in progress)
 * - running → "Running — <url>"
 * - !running → "Stopped"
 */
export function deriveServeStatusLabel(data: ServeStatusData | null): string {
	if (!data) return 'Loading...';
	if (data.running) return `Running — ${data.url ?? 'unknown URL'}`;
	return 'Stopped';
}

/**
 * Decide whether to show a security warning for the selected bind mode.
 *
 * Localhost-only is always safe (only loopback can connect). Network and
 * Tailscale modes expose the UI to other hosts, so credentials should be
 * configured before binding to those interfaces.
 */
export function deriveBindModeWarning(
	bindMode: BindMode,
	authConfigured: boolean,
): string | null {
	if (bindMode === 'localhost') return null;
	if (!authConfigured) {
		return 'Warning: Set auth credentials before exposing the UI over the network.';
	}
	return null;
}

/**
 * Build an HTTP `Authorization` header value for HTTP Basic auth.
 *
 * Exposed for tests and for any future clients that need to dial the
 * serve endpoint with credentials from the desktop UI.
 */
export function buildAuthHeader(username: string, password: string): string {
	return 'Basic ' + btoa(`${username}:${password}`);
}
