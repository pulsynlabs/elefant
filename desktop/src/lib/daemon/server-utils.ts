// Pure utility functions for server URL normalization, ID generation, and locality detection
// These functions have no side effects and no dependencies on project code

/**
 * Normalizes a server URL by:
 * 1. Trimming whitespace
 * 2. Adding http:// if no scheme is present
 * 3. Parsing with URL constructor to normalize
 * 4. Returning url.origin (no trailing slash)
 * 5. Lowercasing the result
 *
 * Does not throw on invalid URLs - returns best-effort normalization.
 */
export function normalizeServerUrl(input: string): string {
	const trimmed = input.trim();

	// If empty, return as-is (caller should validate)
	if (!trimmed) {
		return trimmed;
	}

	// Add scheme if missing
	let withScheme = trimmed;
	if (!/^https?:\/\//i.test(trimmed)) {
		withScheme = `http://${trimmed}`;
	}

	try {
		const url = new URL(withScheme);
		// Return origin (protocol + host) without trailing slash
		// URL.origin is already lowercase for the protocol, but we ensure
		// the host is lowercase as well
		const protocol = url.protocol.toLowerCase();
		const host = url.host.toLowerCase();
		return `${protocol}//${host}`;
	} catch {
		// If URL parsing fails, return the scheme-added version lowercased
		// This handles edge cases like invalid URLs
		return withScheme.toLowerCase().replace(/\/$/, '');
	}
}

/**
 * Generates a stable unique server ID using crypto.randomUUID().
 * Each call returns a new v4 UUID.
 */
export function generateServerId(): string {
	return crypto.randomUUID();
}

/**
 * Checks if a URL points to a local address.
 * Returns true for: localhost, 127.0.0.1, ::1, [::1]
 */
export function isLocalUrl(url: string): boolean {
	if (!url) {
		return false;
	}

	// First, try to extract hostname manually to handle URLs without schemes
	// and bare IPv6 addresses
	const trimmed = url.trim();

	// Try with scheme first
	let withScheme = trimmed;
	if (!/^https?:\/\//i.test(trimmed)) {
		withScheme = `http://${trimmed}`;
	}

	try {
		const parsed = new URL(withScheme);
		const hostname = parsed.hostname.toLowerCase();

		return (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname === '::1' ||
			hostname === '[::1]'
		);
	} catch {
		// If URL parsing fails, try manual extraction
		// This handles malformed URLs like "http://::1" (bare IPv6 without brackets)
		const schemeMatch = trimmed.match(/^(https?:\/\/)(.+)/i);
		if (schemeMatch) {
			const afterScheme = schemeMatch[2];
			// Extract hostname (stop at / or end; allow : for IPv6)
			// For IPv6 without brackets, we need to capture until / or end
			const hostnameMatch = afterScheme.match(/^([^\/]+)/);
			if (hostnameMatch) {
				const hostname = hostnameMatch[1].toLowerCase();
				return (
					hostname === 'localhost' ||
					hostname === '127.0.0.1' ||
					hostname === '::1' ||
					hostname === '[::1]'
				);
			}
		}

		// Check for bare hostname without scheme (e.g., "localhost:1337")
		const bareMatch = trimmed.match(/^([^\/]+)/);
		if (bareMatch) {
			const hostname = bareMatch[1].toLowerCase();
			return (
				hostname === 'localhost' ||
				hostname === '127.0.0.1' ||
				hostname === '::1' ||
				hostname === '[::1]'
			);
		}

		return false;
	}
}

/**
 * Extracts a display name fallback from a URL.
 * Returns the host (hostname + port) from the URL.
 * If parsing fails, returns the input trimmed.
 */
export function serverDisplayNameFallback(url: string): string {
	if (!url) {
		return '';
	}

	const trimmed = url.trim();

	// Try with scheme first (for URLs without scheme)
	let withScheme = trimmed;
	if (!/^https?:\/\//i.test(trimmed)) {
		withScheme = `http://${trimmed}`;
	}

	try {
		const parsed = new URL(withScheme);
		return parsed.host;
	} catch {
		// If URL parsing fails, try to extract host manually
		// Match protocol://host or protocol://host:port
		const match = trimmed.match(/^https?:\/\/([^\/]+)/i);
		if (match) {
			return match[1];
		}

		// Check for bare hostname:port format (e.g., "localhost:1337")
		const bareMatch = trimmed.match(/^([^\/]+)/);
		if (bareMatch) {
			return bareMatch[1];
		}

		// Last resort: return trimmed input
		return trimmed;
	}
}
