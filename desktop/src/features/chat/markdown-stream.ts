// Streaming helpers for `MarkdownRenderer.svelte`.
//
// Kept separate from the component so the logic can be unit-tested
// without a Svelte test renderer. These functions are pure: they take
// the raw source string and return what the renderer should pass to
// `@humanspeak/svelte-markdown` vs. render as a plain `<pre>` streaming
// preview.

export interface StreamingSplit {
	/** Portion of `source` safe to hand to the full markdown lexer. */
	markdown: string;
	/**
	 * Body of a still-open fenced code block (or `null` if every fence is
	 * closed). When non-null, the renderer paints this as a plain `<pre>`
	 * until the closing ``` arrives in a later token.
	 */
	streamingFence: string | null;
}

/**
 * Locate every triple-backtick fence marker that sits at the start of a
 * line (per CommonMark) and split the source in two at the last unclosed
 * fence. If every fence is closed, the full source is returned and the
 * `streamingFence` field is `null`.
 *
 * This runs on every animation frame during streaming, so the
 * implementation is a single linear pass.
 */
export function splitAtOpenFence(source: string): StreamingSplit {
	if (!source) return { markdown: '', streamingFence: null };

	const fenceIndices = findFenceIndices(source);
	if (fenceIndices.length === 0 || fenceIndices.length % 2 === 0) {
		return { markdown: source, streamingFence: null };
	}

	// Odd count → the last fence is still open. Everything before it is
	// safe markdown; the tail becomes the streaming preview.
	const lastFence = fenceIndices[fenceIndices.length - 1]!;
	const markdown = source.slice(0, lastFence);
	const tail = source.slice(lastFence + 3);
	// Drop the info string on the opening line so the preview shows just
	// the code body — matches what `CodeBlock` will eventually render.
	const newlineIdx = tail.indexOf('\n');
	const streamingFence = newlineIdx === -1 ? '' : tail.slice(newlineIdx + 1);
	return { markdown, streamingFence };
}

function findFenceIndices(source: string): number[] {
	const out: number[] = [];
	const len = source.length;
	for (let i = 0; i <= len - 3; i++) {
		if (source.charCodeAt(i) !== 0x60) continue;
		if (source.charCodeAt(i + 1) !== 0x60) continue;
		if (source.charCodeAt(i + 2) !== 0x60) continue;
		// Fence must sit at the start of a line; the prior char is either
		// the beginning of the source or a newline. This mirrors
		// CommonMark and prevents false positives from inline ``` pastes.
		if (i > 0 && source.charCodeAt(i - 1) !== 0x0a) continue;
		out.push(i);
		// Skip the remaining two backticks; a fence is always exactly 3.
		i += 2;
	}
	return out;
}
