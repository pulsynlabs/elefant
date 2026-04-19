# Markdown rendering in the chat surface

The assistant transcript renders markdown through
`desktop/src/features/chat/MarkdownRenderer.svelte`. The renderer wraps
[`@humanspeak/svelte-markdown`](https://github.com/humanspeak/svelte-markdown)
with three project-specific policies:

1. **Fenced code blocks** route through the existing Shiki-backed
   `desktop/src/lib/components/CodeBlock.svelte` so highlighting stays
   consistent with the rest of the app.
2. **Streaming-safe open-fence handling.** While a message is still
   streaming and the latest triple-backtick fence is open (odd count of
   ` ``` `), the tail after that fence is rendered as a plain `<pre>`
   with a blinking cursor. When the closing fence arrives the whole
   block flips back to Shiki highlighting. This avoids re-highlighting
   on every SSE token.
3. **Security hardening.** URLs pass through the local
   `sanitizeUrl` helper (protocol allowlist: `http`, `https`,
   `mailto`); anchors receive `rel="noopener noreferrer"` plus
   `target="_blank"`; raw HTML is mapped to the library's
   unsupported-tag placeholder so `<script>…</script>` never reaches
   the DOM; images are replaced with an `[image: alt]` text token
   until we add a per-project trust model.

## Streaming throttle

`MarkdownRenderer` coalesces source updates into a single animation
frame via `requestAnimationFrame`. Non-streaming messages skip the
throttle so the first paint is synchronous. The window is 16 ms
(one frame) which is low enough to feel instant while keeping the
marked lexer from running on every token chunk.

## Fallback plan

If `@humanspeak/svelte-markdown` ever regresses on our streaming
workload (for example, if a library upgrade changes how token diffing
handles an open code fence and we can no longer tune around it), swap
to the well-understood `marked` + `DOMPurify` combination:

- **Parser:** [`marked`](https://github.com/markedjs/marked) — already
  a transitive dependency. The `Lexer` can be used directly to produce
  a token stream that we render with bespoke Svelte components per
  token type.
- **Sanitizer:** [`DOMPurify`](https://github.com/cure53/DOMPurify)
  with a narrow allowlist (`ALLOWED_TAGS` excluding `script`,
  `style`, `iframe`, `object`, `embed`, `form`, `input`). Configure
  `FORBID_ATTR: ['on*']` to kill event handlers and feed URL
  attributes through the same `sanitizeUrl` helper used by the
  primary path.

Both dependencies are small and battle-tested, so the migration cost is
bounded. The URL sanitizer (`desktop/src/features/chat/url-sanitizer.ts`)
already works standalone and would remain the source of truth under
either renderer.

## Testing

- `url-sanitizer.test.ts` — 30 tests cover the protocol allowlist,
  percent-encoding evasion, whitespace/control-character evasion, and
  malformed input.
- `markdown-stream.test.ts` — covers the open-fence splitter that
  drives the streaming-safe render path, including character-by-
  character simulation of an arriving code block.
- `markdown-security.test.ts` — asserts marked emits `html` tokens for
  hostile input (so the library's unsupported-placeholder renderer
  catches them) and spot-checks the end-to-end hostile URL coverage.

Component-level DOM assertions (e.g. verifying that the rendered
`<a>` has `rel="noopener noreferrer"`) require a Svelte test runner
with a DOM; that work is deferred until the desktop app ships its
first component harness.
