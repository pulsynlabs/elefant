<script lang="ts">
	// Lazy-loaded mermaid diagram renderer with Quire dark theme mapping.
	//
	// `mermaid` is a sizeable dependency (~100kb gzip), so we import it
	// only on first mount via dynamic import. The module is cached by
	// the bundler after the first load; subsequent diagram instances
	// re-use the cached promise.
	//
	// The renderer accepts a viz envelope whose `data.src` is the raw
	// mermaid definition string. Theme variables are mapped from Quire
	// CSS custom properties so the diagram visually matches the rest
	// of the chat surface in both light and dark modes (memoized via
	// `getMermaidThemeVars`).
	//
	// Render errors are caught and surfaced inline as a Quire-styled
	// error chip; the rest of the transcript continues to render.

	import { onMount } from 'svelte';
	import type { VizRendererProps } from './types.js';
	import {
		getMermaidThemeVars,
		mermaidErrorMessage,
	} from './mermaid-state.js';

	let { envelope }: VizRendererProps = $props();

	// The daemon's Zod schema has already validated the envelope; cast
	// the typed shape locally without importing daemon-only types.
	const src = $derived((envelope.data as { src: string }).src);

	let svgOutput = $state<string | null>(null);
	let renderError = $state<string | null>(null);
	let isLoading = $state(true);
	let renderToken = 0;

	async function renderDiagram(definition: string): Promise<void> {
		const myToken = ++renderToken;
		isLoading = true;
		renderError = null;
		svgOutput = null;

		try {
			// Lazy-load mermaid; bundler keeps this off the critical path.
			const mermaidModule = await import('mermaid');
			// Stale render guard — if a newer call already started, abort.
			if (myToken !== renderToken) return;

			const mermaid = mermaidModule.default;
			mermaid.initialize({
				startOnLoad: false,
				theme: 'base',
				themeVariables: getMermaidThemeVars(),
				securityLevel: 'strict',
			});

			// `mermaid.render` requires a unique-ish id per call.
			const id = `mermaid-${envelope.id}-${myToken}`;
			const { svg } = await mermaid.render(id, definition);

			if (myToken !== renderToken) return;
			svgOutput = svg;
		} catch (err) {
			if (myToken !== renderToken) return;
			renderError = mermaidErrorMessage(err);
		} finally {
			if (myToken === renderToken) isLoading = false;
		}
	}

	let hasMounted = false;

	onMount(() => {
		hasMounted = true;
		void renderDiagram(src);
	});

	// Re-render when the source changes after the initial mount. The
	// effect re-runs whenever `src` (a `$derived` of `envelope.data`)
	// changes; the `hasMounted` guard prevents a duplicate first render
	// since `onMount` already kicks off the initial diagram.
	$effect(() => {
		const next = src;
		if (!hasMounted) return;
		void renderDiagram(next);
	});
</script>

<figure class="mermaid-viz" aria-label={envelope.title ?? 'Diagram'}>
	{#if envelope.title}
		<figcaption class="diagram-title">{envelope.title}</figcaption>
	{/if}

	{#if isLoading}
		<div class="state-loading" role="status" aria-live="polite">
			<span class="pulse" aria-hidden="true"></span>
			<span class="state-text">Rendering diagram…</span>
		</div>
	{:else if renderError}
		<div class="state-error" role="alert">
			<span class="error-icon" aria-hidden="true">!</span>
			<span class="state-text">Diagram error: {renderError}</span>
		</div>
	{:else if svgOutput}
		<!-- mermaid renders trusted SVG with `securityLevel: 'strict'` -->
		<div class="diagram-output">{@html svgOutput}</div>
	{/if}
</figure>

<style>
	.mermaid-viz {
		margin: var(--space-2) 0;
		padding: var(--space-4);
		background: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-xs);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.diagram-title {
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 500;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		margin: 0;
	}

	.diagram-output {
		overflow-x: auto;
		max-width: 100%;
	}

	.diagram-output :global(svg) {
		max-width: 100%;
		height: auto;
		display: block;
	}

	/* Loading state */
	.state-loading {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		color: var(--text-muted);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
	}

	.pulse {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--color-primary);
		flex-shrink: 0;
		animation: pulse-anim var(--duration-slow) ease-in-out infinite;
	}

	/* Error state */
	.state-error {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--surface-plate);
		border: 1px solid var(--border-hairline);
		border-left: 3px solid var(--color-error);
		border-radius: var(--radius-sm);
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
	}

	.error-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		background: var(--color-error);
		color: var(--surface-substrate);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 700;
		line-height: 1;
	}

	.state-text {
		line-height: 1.5;
	}

	@keyframes pulse-anim {
		0%,
		100% {
			opacity: 0.4;
			transform: scale(0.85);
		}
		50% {
			opacity: 1;
			transform: scale(1.15);
		}
	}

	/* Reduced motion: tokens.css already neutralises animation
	   globally, but we also dim the pulse so the static state
	   reads as intentional rather than broken. */
	@media (prefers-reduced-motion: reduce) {
		.pulse {
			animation: none;
			opacity: 0.6;
		}
	}
</style>
