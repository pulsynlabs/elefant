/**
 * Diagnostic input shape used by the desktop UI to render LSP-style markers.
 *
 * Coordinates are 1-based (line + column) to match LSP/editor conventions.
 * Optional `endLine`/`endColumn` define a range; when omitted, the diagnostic
 * highlights from `(line, column)` for at least one character.
 */
export interface DiagnosticInput {
	/** 1-based line number where the diagnostic starts. */
	line: number;
	/** 1-based column number where the diagnostic starts. */
	column: number;
	/** 1-based line number where the diagnostic ends (defaults to `line`). */
	endLine?: number;
	/** 1-based column number where the diagnostic ends. */
	endColumn?: number;
	/** Severity level — drives the marker color and gutter icon. */
	severity: 'error' | 'warning' | 'info' | 'hint';
	/** Human-readable diagnostic message shown in hover tooltips. */
	message: string;
	/** Optional diagnostic code (e.g. `TS2304`); appended to the tooltip when present. */
	code?: string;
}
