/**
 * Markdown autolinker — rewrites bare fieldnotes:// URIs and
 * `.elefant/field-notes/**\/*.md` paths inside chat output into chip
 * placeholders that the renderer post-processes into clickable
 * `FieldNotesChip` markup.
 *
 * Two stages, deliberately split so each is unit-testable in Bun
 * without a DOM:
 *
 *   1. {@link autoLinkFieldNotesRefs} runs BEFORE markdown parsing.
 *      It walks the raw source text, finds field-notes links that are
 *      NOT already inside a markdown link `[text](url)` or fenced /
 *      inline code block, and wraps each match in an inline anchor of
 *      the shape `[<uri>](<uri>)`. The library then renders these as
 *      regular anchors, which we hijack via a custom `link` snippet to
 *      mount the chip component.
 *
 *      Stage 1 is intentionally markdown-aware — wrapping with `[](...)`
 *      lets the markdown parser handle escaping, fence detection, and
 *      link-title parsing for us, instead of us hand-rolling all three.
 *
 *   2. {@link injectFieldNotesChips} runs AFTER markdown→HTML rendering
 *      (used by paths that operate on rendered HTML rather than tokens,
 *      e.g. SSR or the future `MessageBody` integration). It finds the
 *      anchor tags whose href matches a field-notes link and rewrites
 *      them into `<a class="field-notes-chip">` markup carrying the URI
 *      on a `data-field-notes-uri` attribute. A separate mount step
 *      turns those into live `FieldNotesChip` instances.
 *
 * Keeping the two stages independent means the chat MarkdownRenderer
 * (which uses Svelte snippets, not raw HTML) can wire stage 1 alone and
 * skip stage 2; future SSR consumers can call stage 2 standalone.
 */

/**
 * Regex matching `fieldnotes://workflow/path[#anchor]` URIs and
 * `.elefant/field-notes/<path>[#anchor]` relative paths.
 *
 * Inlined verbatim from `src/fieldnotes/link.ts` (FIELD_NOTES_LINK_REGEX)
 * so the desktop bundle does not have to cross the daemon's package
 * boundary at build time. If the upstream regex tightens, mirror the
 * change here and bump the round-trip test in this file.
 */
export const FIELD_NOTES_LINK_REGEX =
	/(?:fieldnotes:\/\/(?:[a-zA-Z0-9][a-zA-Z0-9_-]*|_)\/[^\s#)\]}"']+\.md(?:#[^\s)\]}"'.]+)?|\.elefant\/field-notes\/[^\s#)\]}"']+\.md(?:#[^\s)\]}"'.]+)?)/g;

/**
 * A non-global clone for single-match operations (`.test`, `.match`).
 * Sharing a global regex across calls breaks because of `lastIndex`.
 */
const SINGLE_MATCH_REGEX = new RegExp(FIELD_NOTES_LINK_REGEX.source);

/**
 * Test whether a string contains at least one field-notes link. Useful
 * as a fast-path skip before running the full autolinker on a large
 * message body.
 */
export function containsFieldNotesLink(text: string): boolean {
	return SINGLE_MATCH_REGEX.test(text);
}

/**
 * Find spans of the input that should NOT be touched by the autolinker:
 * fenced code blocks (```...```), inline code (`...`), and existing
 * markdown link targets `[text](url)`.
 *
 * Returns an array of [start, end) ranges in source order. The walker
 * below uses these to guard each potential match.
 */
function findProtectedRanges(source: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];

	// Fenced code blocks: ``` ... ``` (we accept any fence length ≥ 3).
	// Conservative: matches the first `\n```` after the opening fence.
	const fenceRe = /```[\s\S]*?```/g;
	for (const match of source.matchAll(fenceRe)) {
		const start = match.index ?? -1;
		if (start >= 0) ranges.push([start, start + match[0].length]);
	}

	// Inline code: `...` on a single line. We use a character-class
	// that excludes backticks to avoid eating `` `code` `` boundaries.
	const inlineRe = /`[^`\n]*`/g;
	for (const match of source.matchAll(inlineRe)) {
		const start = match.index ?? -1;
		if (start >= 0) ranges.push([start, start + match[0].length]);
	}

	// Existing markdown links: [label](href). We only need to protect
	// the (href) portion so we don't double-wrap. Accepts an optional
	// title block for safety.
	const linkRe = /\[[^\]]*\]\([^)]*\)/g;
	for (const match of source.matchAll(linkRe)) {
		const start = match.index ?? -1;
		if (start >= 0) ranges.push([start, start + match[0].length]);
	}

	return ranges;
}

function isInsideRange(index: number, ranges: Array<[number, number]>): boolean {
	for (const [start, end] of ranges) {
		if (index >= start && index < end) return true;
	}
	return false;
}

/**
 * Wrap every bare field-notes link in the markdown source with
 * `[<uri>](<uri>)` so the markdown renderer turns it into a real
 * anchor tag. Anchors that already exist (because the agent wrote
 * `[label](fieldnotes://...)`) are left untouched.
 *
 * Returns the rewritten source. The `FIELD_NOTES_LINK_REGEX.lastIndex`
 * mutation is contained inside this function — callers may pass the
 * exported regex without copying it.
 */
export function autoLinkFieldNotesRefs(source: string): string {
	if (!source || !containsFieldNotesLink(source)) return source;

	const protectedRanges = findProtectedRanges(source);

	let result = '';
	let cursor = 0;

	// Use `matchAll` against a fresh regex iterator to keep this
	// function reentrant — running it twice on the same input must
	// produce the same output.
	const matches = Array.from(source.matchAll(FIELD_NOTES_LINK_REGEX));
	for (const match of matches) {
		const start = match.index ?? -1;
		if (start < 0) continue;
		if (isInsideRange(start, protectedRanges)) continue;

		const uri = match[0];
		result += source.slice(cursor, start);
		result += `[${uri}](${uri})`;
		cursor = start + uri.length;
	}
	result += source.slice(cursor);
	return result;
}

/**
 * Post-process rendered HTML, replacing every anchor whose `href` is a
 * field-notes link with a chip placeholder that the mount step can
 * upgrade into a live `FieldNotesChip` instance.
 *
 * The placeholder is itself a real `<a>` so it remains accessible /
 * keyboard-focusable even before the upgrade runs (or in environments
 * where the upgrade is skipped, e.g. server-rendered previews).
 *
 * The `data-field-notes-uri` attribute carries the original URI verbatim.
 */
export function injectFieldNotesChips(html: string): string {
	if (!html) return html;

	// Match anchors of the form <a href="...">label</a> where the href
	// is a field-notes link. We deliberately accept either single or
	// double quotes; svelte-markdown emits double quotes today.
	const anchorRe = /<a([^>]*?)href=(['"])([^'"]+)\2([^>]*?)>([^<]*)<\/a>/g;

	return html.replace(anchorRe, (_full, pre, _quote, href, post, label) => {
		if (!SINGLE_MATCH_REGEX.test(href)) return _full;
		const escapedHref = escapeAttr(href);
		const escapedLabel = escapeText(label);
		// Strip target / rel attributes injected by the markdown
		// renderer — chip clicks are intercepted in JS and we don't
		// want a fallback navigation to open a new tab.
		const cleanedAttrs = `${pre}${post}`
			.replace(/\s+target=(['"])[^'"]*\1/g, '')
			.replace(/\s+rel=(['"])[^'"]*\1/g, '')
			.trim();
		const attrSep = cleanedAttrs ? ` ${cleanedAttrs}` : '';
		return `<a class="field-notes-chip" href="#"${attrSep} data-field-notes-uri="${escapedHref}" role="link">${escapedLabel}</a>`;
	});
}

// ─── Local escape helpers ──────────────────────────────────────────────
// We escape only the characters that could break out of an attribute or
// a text node. The set is deliberately small — heavier sanitization is
// the renderer's job (DOMPurify-equivalent in MarkdownRenderer).

function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
