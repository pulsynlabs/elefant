// URL sanitizer for markdown-rendered hyperlinks.
//
// Assistant-authored markdown can contain links whose protocols would either
// execute code in-process (`javascript:`), embed arbitrary bytes directly in
// the DOM (`data:`), or leak through the Tauri IPC surface (`tauri:`,
// `file:`). We narrow the allowed set to protocols that only ever open the
// default browser / mail client and reject everything else by returning a
// neutral `#` target.
//
// The sanitizer is deliberately pure and string-only so it can be unit
// tested without the svelte-markdown pipeline, and so it can be reused by
// any future markdown surfaces (release notes, help docs, etc.).

/**
 * Protocols that may appear in rendered anchor `href` attributes. Anything
 * else — including `javascript:`, `data:`, `vbscript:`, `file:`, `tauri:`,
 * and custom scheme handlers — is replaced with `#`.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Sentinel value returned for any URL that fails the protocol check.
 * Using `#` keeps the anchor clickable (no unhandled-navigation error)
 * but navigates to the current view, which is the safest fallback.
 */
export const BLOCKED_URL = '#';

/**
 * Returns the URL unchanged if it points at an allowed protocol,
 * otherwise returns `BLOCKED_URL`.
 *
 * Also allows relative URLs (`/path`, `./x`, `../x`, `#anchor`, `?q=1`,
 * and bare paths with no scheme) because these cannot select a protocol
 * and always resolve against the current document origin.
 *
 * Defends against three common evasion shapes:
 *   1. Leading whitespace and control characters (`\tjavascript:...`)
 *      — HTML parsers historically trim these before resolving the URL.
 *   2. Mixed case (`JaVaScRiPt:...`) — compared lower-cased.
 *   3. Percent-encoded scheme separator (`javascript%3Aalert(1)`)
 *      — decoded once before the check.
 *
 * @param url  Raw `href`/`src` string lifted from a markdown token.
 * @returns    The original URL if safe, `BLOCKED_URL` otherwise.
 */
export function sanitizeUrl(url: string): string {
	if (typeof url !== 'string' || url.length === 0) return BLOCKED_URL;

	// Strip leading whitespace and ASCII control characters the HTML parser
	// would otherwise ignore. Browsers treat \t, \n, \r, and leading spaces
	// as insignificant when resolving `href`, so an attacker could smuggle
	// `\tjavascript:alert(1)` past a naive `startsWith` check.
	const trimmed = stripLeadingControl(url);
	if (trimmed.length === 0) return BLOCKED_URL;

	// Percent-decode once to catch `javascript%3Aalert(1)` and similar.
	// A second pass is not needed: browsers do not double-decode `href`.
	let decoded: string;
	try {
		decoded = decodeURIComponent(trimmed);
	} catch {
		// Malformed percent-encoding — treat as hostile input.
		return BLOCKED_URL;
	}

	const normalized = stripLeadingControl(decoded);
	if (normalized.length === 0) return BLOCKED_URL;

	// Relative URLs: no scheme possible. Safe by definition.
	const firstChar = normalized[0];
	if (firstChar === '/' || firstChar === '#' || firstChar === '?' || firstChar === '.') {
		return url;
	}

	// Detect `scheme:` — the colon must come before any `/`, `?`, `#`, or
	// whitespace, otherwise it is part of a path segment (e.g. the `:` in
	// a matrix URI parameter). We follow the RFC 3986 scheme grammar:
	// ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
	const colonIdx = normalized.indexOf(':');
	if (colonIdx === -1) {
		// No colon → no scheme → bare path. Treat as relative.
		return url;
	}

	const scheme = normalized.slice(0, colonIdx);
	if (!isValidScheme(scheme)) {
		// Colon exists but the characters before it are not a valid scheme
		// (e.g. `foo bar:baz`). Treat as relative to be safe — the browser
		// will either navigate relatively or fail, never execute.
		return url;
	}

	const protocolLower = `${scheme.toLowerCase()}:`;
	if (ALLOWED_PROTOCOLS.has(protocolLower)) {
		return url;
	}

	return BLOCKED_URL;
}

/**
 * Remove leading whitespace (` `, `\t`, `\n`, `\r`, `\f`, `\v`) and ASCII
 * control characters (U+0000 – U+001F except already-covered whitespace,
 * and U+007F) that browsers elide when parsing `href`.
 */
function stripLeadingControl(s: string): string {
	let i = 0;
	while (i < s.length) {
		const code = s.charCodeAt(i);
		// 0x09 = TAB, 0x0A = LF, 0x0B = VT, 0x0C = FF, 0x0D = CR,
		// 0x20 = SPACE, 0x00-0x1F and 0x7F are control chars.
		if (code <= 0x20 || code === 0x7f) {
			i++;
			continue;
		}
		break;
	}
	return i === 0 ? s : s.slice(i);
}

/**
 * RFC 3986 section 3.1: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
 * Rejects empty strings and schemes with leading digits or disallowed
 * characters (which would otherwise be treated as relative URLs).
 */
function isValidScheme(scheme: string): boolean {
	if (scheme.length === 0) return false;
	const first = scheme.charCodeAt(0);
	const isAlpha = (first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a);
	if (!isAlpha) return false;
	for (let i = 1; i < scheme.length; i++) {
		const code = scheme.charCodeAt(i);
		const alpha = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
		const digit = code >= 0x30 && code <= 0x39;
		const extra = code === 0x2b /* + */ || code === 0x2d /* - */ || code === 0x2e; /* . */
		if (!(alpha || digit || extra)) return false;
	}
	return true;
}
