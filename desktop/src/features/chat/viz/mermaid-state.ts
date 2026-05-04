// Pure helpers for the MermaidViz renderer.
//
// `getMermaidThemeVars` reads Quire CSS custom properties from the
// document root (or any element) once, memoizes the result, and
// returns a flat record of `themeVariables` keys consumed by mermaid.
// Tokens are static after the stylesheet loads, so a single read is
// sufficient and avoids repeated `getComputedStyle` calls during
// re-renders.
//
// `isMermaidError` is a defensive guard used by the renderer to
// classify thrown values from `mermaid.render` (which may throw
// either an Error or a plain string with the parse-error message).

export interface MermaidThemeVars {
	background: string;
	primaryColor: string;
	primaryTextColor: string;
	lineColor: string;
	secondaryColor: string;
	tertiaryColor: string;
	edgeLabelBackground: string;
	clusterBkg: string;
	titleColor: string;
	fontFamily: string;
}

let cachedTheme: MermaidThemeVars | null = null;

const TOKEN_KEYS = [
	'--surface-substrate',
	'--color-primary',
	'--text-prose',
	'--border-edge',
	'--surface-plate',
	'--surface-leaf',
	'--font-sans',
] as const;

type TokenKey = (typeof TOKEN_KEYS)[number];

/**
 * Read a single CSS custom property from a CSSStyleDeclaration with a
 * fallback for environments where the variable is not defined (e.g.
 * SSR, JSDOM). Trims whitespace returned by `getPropertyValue`.
 */
function readToken(styles: CSSStyleDeclaration, name: TokenKey, fallback: string): string {
	const raw = styles.getPropertyValue(name);
	const trimmed = typeof raw === 'string' ? raw.trim() : '';
	return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Map Quire CSS custom property values (read via `getComputedStyle`)
 * to mermaid `themeVariables`. Memoized after the first call — call
 * `_resetMermaidThemeCache()` in tests to invalidate.
 */
export function getMermaidThemeVars(el?: Element): MermaidThemeVars {
	if (cachedTheme) return cachedTheme;

	// Defensive defaults so the renderer still produces a coherent
	// dark-themed diagram if `getComputedStyle` is unavailable (SSR,
	// node test environment, etc.).
	const fallbacks: Record<TokenKey, string> = {
		'--surface-substrate': '#0a0a0e',
		'--color-primary': '#4049e1',
		'--text-prose': '#ededf3',
		'--border-edge': 'rgba(255, 255, 255, 0.10)',
		'--surface-plate': '#11111a',
		'--surface-leaf': '#16162a',
		'--font-sans': 'system-ui, sans-serif',
	};

	const target =
		el ??
		(typeof document !== 'undefined' ? document.documentElement : null);

	if (!target || typeof getComputedStyle !== 'function') {
		cachedTheme = {
			background: fallbacks['--surface-substrate'],
			primaryColor: fallbacks['--color-primary'],
			primaryTextColor: fallbacks['--text-prose'],
			lineColor: fallbacks['--border-edge'],
			secondaryColor: fallbacks['--surface-plate'],
			tertiaryColor: fallbacks['--surface-leaf'],
			edgeLabelBackground: fallbacks['--surface-plate'],
			clusterBkg: fallbacks['--surface-plate'],
			titleColor: fallbacks['--text-prose'],
			fontFamily: fallbacks['--font-sans'],
		};
		return cachedTheme;
	}

	const styles = getComputedStyle(target);
	cachedTheme = {
		background: readToken(styles, '--surface-substrate', fallbacks['--surface-substrate']),
		primaryColor: readToken(styles, '--color-primary', fallbacks['--color-primary']),
		primaryTextColor: readToken(styles, '--text-prose', fallbacks['--text-prose']),
		lineColor: readToken(styles, '--border-edge', fallbacks['--border-edge']),
		secondaryColor: readToken(styles, '--surface-plate', fallbacks['--surface-plate']),
		tertiaryColor: readToken(styles, '--surface-leaf', fallbacks['--surface-leaf']),
		edgeLabelBackground: readToken(styles, '--surface-plate', fallbacks['--surface-plate']),
		clusterBkg: readToken(styles, '--surface-plate', fallbacks['--surface-plate']),
		titleColor: readToken(styles, '--text-prose', fallbacks['--text-prose']),
		fontFamily: readToken(styles, '--font-sans', fallbacks['--font-sans']),
	};
	return cachedTheme;
}

/** Test-only: reset the memoization cache. Not exported from any runtime barrel. */
export function _resetMermaidThemeCache(): void {
	cachedTheme = null;
}

/**
 * Classify a value thrown by `mermaid.render`. Mermaid throws either
 * `Error` instances (most syntax errors) or raw strings (some legacy
 * paths / parse messages). Anything else is treated as non-mermaid
 * noise and falls through to a generic message in the renderer.
 */
export function isMermaidError(err: unknown): boolean {
	if (err instanceof Error) return true;
	if (typeof err === 'string') return true;
	return false;
}

/**
 * Extract a human-readable message from a mermaid render rejection.
 * Falls back to a constant string when nothing useful can be read.
 */
export function mermaidErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'string') return err;
	return 'Failed to render diagram';
}
