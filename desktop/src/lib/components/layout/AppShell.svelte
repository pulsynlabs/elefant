<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import { commandsStore } from "$lib/stores/commands.svelte.js";

	type Props = {
		sidebar?: Snippet;
		topbar?: Snippet;
		children?: Snippet;
		rightPanel?: Snippet;
		rightPanelOpen?: boolean;
		layoutMode?: 'expanded' | 'collapsed' | 'mobileOverlay';
	};

	let {
		sidebar,
		topbar,
		children,
		rightPanel,
		rightPanelOpen = false,
		layoutMode = 'expanded',
	}: Props = $props();

	// The right panel is an inline grid column on desktop only.
	// On mobile (≤640px) the panel is rendered as a separate bottom sheet
	// outside this shell — see SPEC MH10. We never widen the grid in
	// mobileOverlay mode, regardless of `rightPanelOpen`, so the chat
	// content keeps the full viewport width when a mobile sheet is open
	// underneath.
	const rightPanelInlineOpen = $derived(
		rightPanelOpen && rightPanel !== undefined && layoutMode !== 'mobileOverlay',
	);

	// Pre-fetch slash commands so the completion overlay has data
	// immediately when the user first types `/`. Without this the
	// overlay mounts with an empty list and renders nothing on the
	// initial keystroke. Fire-and-forget — the store deduplicates
	// concurrent calls and never throws to the UI.
	onMount(() => {
		void commandsStore.load();
	});
</script>

<div
	class="app-shell"
	class:mode-collapsed={layoutMode === 'collapsed'}
	class:mode-mobile={layoutMode === 'mobileOverlay'}
	class:has-right-panel={rightPanelInlineOpen}
>
	<!-- Sidebar — Quire md surface (bound editorial sheet, no blur) -->
	<aside class="sidebar quire-md" aria-label="Navigation sidebar">
		{@render sidebar?.()}
	</aside>

	<!-- Main area: topbar + content. Topbar deliberately lives inside the
	     main column so it never spans across the right panel — the right
	     panel renders its own header (added in W1.T2). -->
	<div class="main-area">
		<header class="topbar quire-sm" aria-label="Application toolbar">
			{@render topbar?.()}
		</header>
		<main class="content texture-noise">
			{@render children?.()}
		</main>
	</div>

	<!-- Right panel — optional 3rd inline column. Only rendered on desktop
	     (≥641px) and only when the consumer passes both `rightPanel` and
	     `rightPanelOpen=true`. On mobile (≤640px) the panel is rendered
	     as a fixed bottom sheet outside this shell (see SPEC MH10). -->
	{#if rightPanelInlineOpen}
		<aside
			class="right-panel"
			aria-label="Session panel"
		>
			{@render rightPanel?.()}
		</aside>
	{/if}
</div>

<style>
	/* Component-scoped width for the optional right panel column. Defined
	   here (not in tokens.css) because it's component-specific to AppShell —
	   no other surface owns this measurement. SPEC MH9 fixes v1 at 320px,
	   not user-resizable. */
	.app-shell {
		--right-panel-width: 320px;

		display: grid;
		grid-template-columns: var(--sidebar-width) 1fr;
		grid-template-rows: 1fr;
		/* Dual declaration: older browsers honor 100vh, modern mobile
		   browsers (iOS Safari 16+, Chrome 108+) override with 100dvh
		   so collapsing URL chrome doesn't trigger a layout shift. */
		height: 100vh;
		height: 100dvh;
		width: 100vw;
		overflow: hidden;
		background-color: var(--surface-substrate);
		color: var(--text-prose);
		transition: grid-template-columns var(--transition-spring);
		position: relative;
	}

	/* Single fluid indigo ambient field — position: fixed so it covers the
	   entire viewport behind every layer. Orbs in child views (e.g. hero)
	   must NOT use overflow:hidden or isolation:isolate so they bleed
	   into each other and into this gradient without a hard seam. */
	.app-shell::before {
		content: '';
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 0;
		background:
			/* Primary bloom: top-center, tall enough to reach the fold */
			radial-gradient(
				ellipse 1400px 1000px at 50% -5%,
				color-mix(in oklch, var(--color-primary) 18%, transparent) 0%,
				color-mix(in oklch, var(--color-primary) 10%, transparent) 25%,
				color-mix(in oklch, var(--color-primary) 4%, transparent) 55%,
				transparent 85%
			),
			/* Left mid-bloom — anchors the left side */
			radial-gradient(
				ellipse 900px 700px at 15% 35%,
				color-mix(in oklch, var(--color-primary) 10%, transparent) 0%,
				color-mix(in oklch, var(--color-primary) 4%, transparent) 45%,
				transparent 80%
			),
			/* Right accent — subtle tint near top-right */
			radial-gradient(
				ellipse 700px 600px at 85% 15%,
				color-mix(in oklch, var(--color-primary) 8%, transparent) 0%,
				color-mix(in oklch, var(--color-primary) 3%, transparent) 45%,
				transparent 78%
			);
	}

	.app-shell.mode-collapsed {
		grid-template-columns: var(--sidebar-width-collapsed) 1fr;
	}

	.app-shell.mode-mobile {
		/* Sidebar column collapses to nothing — content fills full width.
		   The drawer is rendered as a sibling outside this grid (in App.svelte)
		   so it isn't clipped by the shell's overflow:hidden. */
		grid-template-columns: 0 1fr;
	}

	/* Three-column layout — right panel inline at desktop widths. The
	   `has-right-panel` class is only applied when layoutMode !== 'mobileOverlay'
	   (computed in script), so this rule never fires on mobile. The
	   transition on .app-shell animates this change smoothly. */
	.app-shell.has-right-panel {
		grid-template-columns: var(--sidebar-width) 1fr var(--right-panel-width);
	}

	.app-shell.has-right-panel.mode-collapsed {
		grid-template-columns: var(--sidebar-width-collapsed) 1fr var(--right-panel-width);
	}

	/* In mobile-overlay mode the inline aside is unused (drawer takes its
	   place). Hide it from layout and assistive tech without unmounting,
	   so the sidebar snippet stays satisfied. */
	.app-shell.mode-mobile .sidebar {
		visibility: hidden;
		width: 0;
		overflow: hidden;
		border: none;
	}

	.sidebar {
		grid-row: 1 / 2;
		grid-column: 1 / 2;
		display: flex;
		flex-direction: column;
		overflow: clip;
		/* Match the shell's dual-declaration so the sidebar tracks the
		   dynamic viewport on mobile browsers without layout shift. */
		height: 100vh;
		height: 100dvh;
		position: relative;
		z-index: var(--z-sticky);
		transition: width var(--transition-spring);
	}

	/* Sidebar override — transparent to let the single AppShell gradient show through.
	   Only keep the trailing hairline border for visual separation. */
	:global(.sidebar.quire-md) {
		background: transparent !important;
		box-shadow: none;
		border: none;
		border-right: 1px solid var(--border-edge);
		border-radius: 0;
	}

	:global([data-theme="light"] .sidebar.quire-md) {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.7),
			inset 0 -1px 0 rgba(64, 73, 225, 0.04);
	}

	.main-area {
		grid-row: 1 / 2;
		grid-column: 2 / 3;
		display: grid;
		grid-template-rows: var(--topbar-height) 1fr;
		/* overflow: hidden removed — it was clipping the hero orbs in
		   ProjectPickerView. Overflow is managed per-child instead:
		   .content handles scroll, .topbar is sticky-positioned. */
		overflow: visible;
		position: relative;
		z-index: 1;
	}

	.topbar {
		grid-row: 1 / 2;
		display: flex;
		align-items: center;
		padding: 0 0 0 var(--space-4);
		gap: var(--space-3);
		height: var(--topbar-height);
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
		/* Transparent to let the single AppShell gradient show through.
		   !important overrides .quire-sm background from quire.css. */
		background: transparent !important;
		border-top: none !important;
		border-left: none !important;
		border-right: none !important;
		border-radius: 0 !important;
		box-shadow: none !important;
	}

	.content {
		grid-row: 2 / 3;
		position: relative;
		overflow: hidden;
		background: transparent;
	}

	/* Right panel column — sits at column 3 / 4. Has its own internal
	   header/footer (rendered by the consumer via the `rightPanel` snippet);
	   AppShell is purely the layout slot. The leading hairline border
	   matches the trailing border on .sidebar for visual symmetry. */
	.right-panel {
		grid-row: 1 / 2;
		grid-column: 3 / 4;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		height: 100vh;
		height: 100dvh;
		position: relative;
		z-index: var(--z-sticky);
		background-color: var(--surface-substrate);
		border-left: 1px solid var(--border-edge);
	}

	@media (max-width: 900px) {
		.app-shell:not(.mode-mobile):not(.has-right-panel) {
			grid-template-columns: var(--sidebar-width-collapsed) 1fr;
		}
		/* When the right panel is open in this width band the sidebar is
		   already collapsed (see .app-shell.has-right-panel.mode-collapsed
		   above); the main column simply takes the remaining 1fr space. */
	}

	@media (max-width: 640px) {
		/* Force full-width content even before JS hydrates the layout mode.
		   Also overrides .has-right-panel — on mobile the panel is rendered
		   as a separate bottom sheet (SPEC MH10), never as an inline column. */
		.app-shell,
		.app-shell.has-right-panel {
			grid-template-columns: 0 1fr;
		}
	}
</style>
