/**
 * Parse `<suggest-viz>` elements from subagent closing XML.
 *
 * Subagents cannot call `visualize` directly. Instead they emit
 * `<suggest-viz>` hints in their XML envelope; the orchestrator
 * reads them via `parseSuggestViz` and decides whether to render.
 *
 * Never throws — all parse failures return an empty array.
 */

export interface SuggestViz {
	type: string;
	data: Record<string, unknown>;
	intent?: string;
}

/**
 * Parse zero or more `<suggest-viz>` elements from a subagent's
 * closing XML string. Returns `[]` on any parse failure or if no
 * elements are found. Never throws.
 */
export function parseSuggestViz(xml: string): SuggestViz[] {
	if (!xml || typeof xml !== 'string') return [];

	try {
		const results: SuggestViz[] = [];
		const elements = findSuggestVizElements(xml);

		for (const elem of elements) {
			const attrsStr = elem;
			const type = extractAttr(attrsStr, 'type');
			const dataStr = extractAttr(attrsStr, 'data');
			const intent = extractAttr(attrsStr, 'intent');

			if (!type || !dataStr) continue;

			try {
				const data = JSON.parse(dataStr);
				if (typeof data !== 'object' || data === null || Array.isArray(data)) continue;
				results.push({ type, data, intent: intent || undefined });
			} catch {
				continue; // skip malformed data attribute
			}
		}

		return results;
	} catch {
		return [];
	}
}

/**
 * Find all `<suggest-viz ... />` or `<suggest-viz ... >` element bodies
 * in the XML string. Scans character-by-character so that `>` inside
 * quoted attribute values (e.g. `data='{"src":"A-->B"}'`) does not
 * prematurely terminate the element match.
 */
function findSuggestVizElements(xml: string): string[] {
	const elements: string[] = [];
	const tagStart = '<suggest-viz';
	const len = xml.length;
	let i = 0;

	while (i < len) {
		const start = xml.indexOf(tagStart, i);
		if (start === -1) break;

		// Scan forward from after the tag name, respecting quote state.
		let j = start + tagStart.length;
		let inSingle = false;
		let inDouble = false;

		while (j < len) {
			const ch = xml[j];

			if (!inSingle && !inDouble) {
				// Self-closing `/>`
				if (ch === '/' && j + 1 < len && xml[j + 1] === '>') {
					elements.push(xml.slice(start + tagStart.length + 1, j));
					i = j + 2;
					break;
				}
				// Non-self-closing `>`
				if (ch === '>') {
					elements.push(xml.slice(start + tagStart.length + 1, j));
					i = j + 1;
					break;
				}
				if (ch === "'") inSingle = true;
				else if (ch === '"') inDouble = true;
			} else if (inSingle && ch === "'") {
				inSingle = false;
			} else if (inDouble && ch === '"') {
				inDouble = false;
			}

			j++;
		}

		// If we never found the closing bracket, advance past this match.
		if (j >= len) {
			i = start + tagStart.length;
		}
	}

	return elements;
}

/**
 * Extract an attribute value by name from an XML attribute string.
 * Uses a backreference so the same quote character that opens the
 * value also closes it — double-quotes inside a single-quoted value
 * (common in JSON data attributes) are handled correctly.
 */
function extractAttr(attrsStr: string, name: string): string | null {
	const pattern = new RegExp(`${name}=(["'])(.*?)\\1`);
	const m = pattern.exec(attrsStr);
	return m ? m[2] : null;
}
