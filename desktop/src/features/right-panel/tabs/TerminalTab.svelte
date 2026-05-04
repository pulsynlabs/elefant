<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Spinner } from '$lib/components/ui/spinner';
	import { createRenderer } from '../terminal/renderer.js';
	import type { TerminalRenderer } from '../terminal/renderer.js';
	import { terminalResize } from '../terminal/terminal-action.js';

	type Props = {
		/**
		 * Identifies the chat session this terminal belongs to. Used by the
		 * PTY bridge in W4.T3; in this task it is accepted (and surfaced
		 * via aria-label) so the wiring is in place when the bridge lands.
		 */
		sessionId: string;
		/**
		 * Identifies the project this terminal belongs to. Same forward-
		 * compatibility note as `sessionId`.
		 */
		projectId: string;
		/**
		 * Called for every byte the user types into the terminal. The PTY
		 * bridge (W4.T3) will forward this to the WebSocket; until then
		 * the renderer still exists and accepts input — keystrokes are
		 * simply buffered to the parent through this callback.
		 */
		onData?: (data: string) => void;
	};

	let { sessionId, projectId, onData }: Props = $props();

	// ── Element refs + renderer state ─────────────────────────────────────
	//
	// `containerEl` is the DOM node the renderer mounts into. `rootEl` is
	// the outer wrapper used purely for theme resolution — `resolveTheme`
	// reads CSS custom properties from whichever element is passed, and the
	// outer wrapper inherits the document's theme tokens whether we are
	// in light or dark mode.

	let containerEl = $state<HTMLDivElement | null>(null);
	let rootEl = $state<HTMLDivElement | null>(null);

	// `renderer` is reactive so the `terminalResize` action receives the
	// instance the moment async creation resolves. `loadError` flips on
	// when both the primary (ghostty-web) and fallback (xterm) creators
	// throw — `createRenderer` handles the fallback internally, so getting
	// here means the environment cannot host any terminal renderer.
	let renderer = $state<TerminalRenderer | null>(null);
	let loadError = $state(false);

	// Tracks whether `onMount` already ran. The off-data subscription is
	// established inside `onMount`, but we need to be able to unsubscribe
	// from `onDestroy` even if the component unmounts before mount finishes
	// (e.g. user closes the panel mid-spawn).
	let unsubscribeData: (() => void) | null = null;
	let cancelled = false;

	onMount(() => {
		// Defensive: $state is initialised after the first render, so by
		// the time onMount runs both refs should be set. If they are not,
		// something has gone very wrong upstream — bail out into the error
		// state rather than throwing on a null reference.
		if (!containerEl || !rootEl) {
			loadError = true;
			return;
		}

		// Capture refs into locals so TypeScript narrows them inside the
		// async closure below — `containerEl` is reactive `$state` and the
		// type system treats reads inside the closure as possibly-null.
		const container = containerEl;
		const root = rootEl;

		void (async () => {
			try {
				const created = await createRenderer({ rootEl: root });
				if (cancelled) {
					// Component unmounted while we were awaiting WASM init —
					// throw away the half-built renderer to avoid a leak.
					created.dispose();
					return;
				}

				created.mount(container);
				unsubscribeData = created.onData((chunk) => {
					onData?.(chunk);
				});

				// Assign last so the action helper sees a fully-mounted
				// instance on its first `update` tick.
				renderer = created;

				// Focus the terminal so the user can type immediately
				// after activating the tab. Skipped on initial idle mount
				// when the tab itself is not yet user-visible — the focus
				// call is harmless either way.
				created.focus();
			} catch (error) {
				if (import.meta.env.DEV) {
					console.error('[terminal-tab] renderer init failed', error);
				}
				loadError = true;
			}
		})();
	});

	onDestroy(() => {
		cancelled = true;
		unsubscribeData?.();
		unsubscribeData = null;
		renderer?.dispose();
		renderer = null;
	});

	// `sessionId` / `projectId` are accepted now to lock the component's
	// public surface; they are referenced in the aria-label below so the
	// linter does not flag them as unused props until W4.T3 wires them up
	// to the PTY bridge.
	const ariaLabel = $derived(`Terminal for session ${sessionId} in project ${projectId}`);
	const isLoading = $derived(!renderer && !loadError);
</script>

<div class="terminal-tab" bind:this={rootEl}>
	<div
		bind:this={containerEl}
		class="terminal-container"
		role="application"
		aria-label={ariaLabel}
		use:terminalResize={renderer}
	></div>

	{#if isLoading}
		<div class="terminal-overlay" role="status" aria-live="polite">
			<Spinner size="md" tone="muted" />
			<span class="overlay-text">Starting terminal…</span>
		</div>
	{:else if loadError}
		<div class="terminal-overlay" role="alert">
			<span class="overlay-text overlay-text-error">Terminal unavailable</span>
		</div>
	{/if}
</div>

<style>
	.terminal-tab {
		/* Fill the tab content area provided by RightPanel. The wrapper is
		   the theme-resolution root for `resolveTheme`, so it must also
		   inherit the document's CSS custom properties (it does, by virtue
		   of being a descendant of `:root`). */
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
		background-color: var(--surface-substrate);
		padding: var(--space-2);
	}

	.terminal-container {
		/* The renderer paints into this element. position:relative is a
		   xterm.js requirement — it positions internal elements absolutely
		   and the FitAddon reads dimensions from the offsetParent. */
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
		font-family: var(--font-mono);
		/* Renderers manage their own scrollback; clip anything that would
		   otherwise spill past the panel's column. */
		overflow: hidden;
	}

	/* xterm injects its own elements; tweak the canvas/scrollbar tone to
	   match the panel surface so users do not see a hard rectangle at the
	   edges. The renderer's own theme drives the cell colours; this is
	   strictly the chrome around it. */
	.terminal-container :global(.xterm) {
		padding: 0;
	}

	.terminal-container :global(.xterm-viewport) {
		background-color: transparent !important;
		scrollbar-color: var(--border-edge) transparent;
		scrollbar-width: thin;
	}

	.terminal-container :global(.xterm-viewport::-webkit-scrollbar) {
		width: 8px;
	}

	.terminal-container :global(.xterm-viewport::-webkit-scrollbar-thumb) {
		background-color: var(--border-edge);
		border-radius: var(--radius-sm);
	}

	.terminal-overlay {
		/* Sits on top of the renderer container while it is loading or
		   when initialisation has failed. `pointer-events: none` keeps it
		   from swallowing clicks that should reach the renderer the moment
		   it appears — the spinner is informational, not interactive. */
		position: absolute;
		inset: var(--space-2);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		pointer-events: none;
		background-color: color-mix(in oklch, var(--surface-substrate) 88%, transparent);
		border-radius: var(--radius-sm);
	}

	.overlay-text {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-meta);
		letter-spacing: 0.02em;
	}

	.overlay-text-error {
		color: var(--text-muted);
	}
</style>
