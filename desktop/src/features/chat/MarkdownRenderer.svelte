<!--
@component
MarkdownRenderer — the single source of truth for rendering assistant
markdown in the chat surface. Wraps `@humanspeak/svelte-markdown` with
three project-specific policies:

  1. Fenced code blocks route through the existing Shiki-powered
     `CodeBlock.svelte` so syntax highlighting stays consistent with the
     rest of the app.
  2. While a message is streaming and the latest fence is still open
     (odd number of ``` markers), the tail renders as a plain `<pre>`
     with a streaming indicator; once the closing fence arrives the
     whole block switches back to Shiki. This avoids re-highlighting on
     every token and prevents the jitter that caused us to fall back to
     regex rendering in the first place.
  3. URLs are hardened by the shared `sanitizeUrl` helper, anchors gain
     `rel="noopener noreferrer"` + `target="_blank"`, raw HTML is
     disabled end-to-end, and images are replaced with a textual
     placeholder.

Render updates during streaming are throttled to one animation frame so
the lexer does not run on every SSE token. Non-streaming renders bypass
the throttle for a synchronous first paint.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import SvelteMarkdown, { buildUnsupportedHTML } from '@humanspeak/svelte-markdown';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import { sanitizeUrl } from './url-sanitizer.js';
	import { splitAtOpenFence } from './markdown-stream.js';

	type Props = {
		source: string;
		streaming?: boolean;
		/** Overrides default throttling/rAF behaviour for unit tests. */
		nowFn?: () => number;
	};

	let { source, streaming = false, nowFn }: Props = $props();

	// Throttled mirror of `source`. During streaming we coalesce writes
	// into one rAF tick so svelte-markdown only re-parses once per frame.
	// The first-render effect below syncs the prop into this state.
	let displayedSource = $state<string>('');

	// Non-streaming → just mirror synchronously; the content is final.
	// Streaming → split the source at the last unclosed code fence.
	// Everything before the open fence is rendered as markdown, and the
	// trailing unclosed fence is rendered as plain <pre> until it closes.
	const split = $derived(splitAtOpenFence(displayedSource));

	let pendingFrame: number | null = null;
	let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
	const FRAME_BUDGET_MS = 16;
	let lastFlushAt = 0;

	function now(): number {
		if (nowFn) return nowFn();
		if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
			return performance.now();
		}
		return Date.now();
	}

	function flush(): void {
		pendingFrame = null;
		pendingTimeout = null;
		lastFlushAt = now();
		displayedSource = untrack(() => source);
	}

	function scheduleFlush(): void {
		if (pendingFrame !== null || pendingTimeout !== null) return;
		const elapsed = now() - lastFlushAt;
		if (elapsed >= FRAME_BUDGET_MS) {
			flush();
			return;
		}
		const delay = Math.max(0, FRAME_BUDGET_MS - elapsed);
		if (typeof requestAnimationFrame === 'function' && !nowFn) {
			pendingFrame = requestAnimationFrame(flush);
		} else {
			pendingTimeout = setTimeout(flush, delay);
		}
	}

	$effect(() => {
		const nextSource = source;
		const isStreaming = streaming;
		if (!isStreaming) {
			// Finalized content — skip the frame budget so closed fences
			// and trailing text paint synchronously.
			if (pendingFrame !== null && typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(pendingFrame);
				pendingFrame = null;
			}
			if (pendingTimeout !== null) {
				clearTimeout(pendingTimeout);
				pendingTimeout = null;
			}
			displayedSource = nextSource;
			lastFlushAt = now();
			return;
		}
		scheduleFlush();
	});

	onDestroy(() => {
		if (pendingFrame !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(pendingFrame);
		}
		if (pendingTimeout !== null) {
			clearTimeout(pendingTimeout);
		}
	});

	// Raw HTML is disabled by mapping every known HTML tag to the
	// library's unsupported-placeholder component. svelte-markdown emits
	// blocked tags as inert escaped text, so a raw script element in
	// assistant output cannot reach the document.
	const blockedHtml = buildUnsupportedHTML();
	const renderers = { html: blockedHtml };

	// The library calls `sanitizeUrl` with `(url, context)`; we only
	// care about the URL string for the allowlist check.
	const sanitize = (url: string): string => sanitizeUrl(url);
</script>

<div class="markdown">
	<SvelteMarkdown
		source={split.markdown}
		{streaming}
		{renderers}
		sanitizeUrl={sanitize}
		options={{ headerIds: false }}
	>
		{#snippet code({ lang, text })}
			<CodeBlock code={text} language={lang || 'text'} />
		{/snippet}

		{#snippet codespan({ text })}
			<code class="inline-code">{text ?? ''}</code>
		{/snippet}

		{#snippet link({ href, title, children })}
			<a
				href={sanitize(href ?? '')}
				{title}
				target="_blank"
				rel="noopener noreferrer"
				class="markdown-link"
			>
				{#if children}
					{@render children()}
				{/if}
			</a>
		{/snippet}

		{#snippet image({ text })}
			<!--
				Images are disabled in v1: assistant output can embed
				arbitrary remote URLs (including tracking pixels and
				polyglot SVGs). Until a per-project trust model exists we
				surface the alt text only so the user sees something was
				stripped.
			-->
			<span class="markdown-image-placeholder" aria-label="image">
				[image{text ? `: ${text}` : ''}]
			</span>
		{/snippet}
	</SvelteMarkdown>

	{#if streaming && split.streamingFence !== null}
		<pre class="streaming-fence" aria-label="streaming code block"><code
				>{split.streamingFence}</code><span class="streaming-cursor" aria-hidden="true"
			></span></pre>
	{/if}
</div>

<style>
	.markdown {
		font-size: var(--font-size-md);
		line-height: var(--line-height-relaxed);
		color: var(--color-text-primary);
	}

	.markdown :global(p) {
		margin: 0 0 var(--space-3);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.markdown :global(p:last-child) {
		margin-bottom: 0;
	}

	.markdown :global(h1),
	.markdown :global(h2),
	.markdown :global(h3),
	.markdown :global(h4),
	.markdown :global(h5),
	.markdown :global(h6) {
		margin: var(--space-4) 0 var(--space-2);
		font-weight: var(--font-weight-semibold);
		line-height: var(--line-height-tight);
		color: var(--color-text-primary);
	}

	.markdown :global(h1) {
		font-size: var(--font-size-xl);
	}
	.markdown :global(h2) {
		font-size: var(--font-size-lg);
	}
	.markdown :global(h3) {
		font-size: var(--font-size-md);
	}
	.markdown :global(h4),
	.markdown :global(h5),
	.markdown :global(h6) {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
	}

	.markdown :global(h1:first-child),
	.markdown :global(h2:first-child),
	.markdown :global(h3:first-child) {
		margin-top: 0;
	}

	.markdown :global(strong) {
		font-weight: var(--font-weight-semibold);
	}

	.markdown :global(em) {
		font-style: italic;
	}

	.markdown :global(del) {
		text-decoration: line-through;
		color: var(--color-text-muted);
	}

	.markdown :global(ul),
	.markdown :global(ol) {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-5);
	}

	.markdown :global(li) {
		margin: 0 0 var(--space-1);
	}

	.markdown :global(li > p) {
		margin: 0;
	}

	.markdown :global(blockquote) {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-4);
		border-left: 3px solid var(--color-border);
		color: var(--color-text-secondary);
		background-color: color-mix(in oklch, var(--color-surface) 60%, transparent);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.markdown :global(hr) {
		margin: var(--space-4) 0;
		border: 0;
		border-top: 1px solid var(--color-border);
	}

	.markdown :global(table) {
		width: 100%;
		margin: 0 0 var(--space-3);
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}

	.markdown :global(th),
	.markdown :global(td) {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		text-align: left;
		vertical-align: top;
	}

	.markdown :global(th) {
		background-color: var(--color-surface);
		font-weight: var(--font-weight-semibold);
	}

	.markdown :global(.inline-code) {
		padding: 0.1em 0.35em;
		border-radius: var(--radius-sm);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 0.9em;
		color: var(--color-text-primary);
		word-break: break-word;
	}

	.markdown :global(.markdown-link) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.markdown :global(.markdown-link:hover) {
		color: var(--color-primary-hover, var(--color-primary));
	}

	.markdown :global(.markdown-link:focus-visible) {
		outline: 2px solid var(--color-focus, var(--color-primary));
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.markdown :global(.markdown-image-placeholder) {
		display: inline-block;
		padding: 0.1em 0.35em;
		border-radius: var(--radius-sm);
		background-color: var(--color-surface-elevated);
		border: 1px dashed var(--color-border);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-family: var(--font-mono);
	}

	.streaming-fence {
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		background-color: var(--color-surface-elevated);
		color: var(--color-text-secondary);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
		word-break: break-word;
		overflow-x: auto;
	}

	.streaming-cursor {
		display: inline-block;
		width: 2px;
		height: 1em;
		background-color: var(--color-primary);
		vertical-align: text-bottom;
		margin-left: 2px;
		animation: markdown-blink 1s step-end infinite;
	}

	@keyframes markdown-blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.streaming-cursor {
			animation: none;
		}
	}
</style>
