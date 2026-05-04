// Pure helpers for the `table` viz renderer.
//
// `TableViz` accepts an opaque `Record<string, unknown>` per row from
// the daemon (the Zod schema lives daemon-side; the desktop bundle
// trusts the validated envelope). Cells may be missing, nested, or
// non-primitive — these helpers coerce any value into a printable
// string without throwing, so the renderer can stay logic-free.

/** Coerce any value into a stable printable string. Never throws. */
export function safeStringify(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	try {
		return JSON.stringify(v);
	} catch {
		// Circular structures or other JSON.stringify failures fall
		// back to the default object string so the cell still renders.
		return String(v);
	}
}

/** Extract the printable cell value for a given column key from a row. */
export function getCellValue(
	row: Record<string, unknown>,
	col: string,
): string {
	return safeStringify(row[col]);
}
