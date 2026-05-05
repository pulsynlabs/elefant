<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import { commandsStore } from "$lib/stores/commands.svelte.js";

	const RIGHT_PANEL_MIN = 240;
	const RIGHT_PANEL_MAX = 600;
	const RIGHT_PANEL_DEFAULT = 320;
	const LS_KEY = 'elefant.rightPanelWidth';

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

	// Persisted panel width, restored from localStorage on mount.
	let rightPanelWidth = $state(RIGHT_PANEL_DEFAULT);

	// The right panel is an inline grid column on desktop only.
	const rightPanelInlineOpen = $derived(
		rightPanelOpen && rightPanel !== undefined && layoutMode !== 'mobileOverlay',
	);

	// ── Drag-to-resize ────────────────────────────────────────────────────
	let isDragging = $state(false);
	let dragStartX = 0;
	let dragStartWidth = 0;

	function startResize(event: MouseEvent) {
		event.preventDefault();
		isDragging = true;
		dragStartX = event.clientX;
		dragStartWidth = rightPanelWidth;

		function onMove(e: MouseEvent) {
			// Dragging left (smaller clientX) = wider panel
			const delta = dragStartX - e.clientX;
			rightPanelWidth = Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, dragStartWidth + delta));
		}

		function onUp() {
			isDragging = false;
			try { localStorage.setItem(LS_KEY, String(rightPanelWidth)); } catch {}
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	onMount(() => {
		// Restore persisted width
		try {
			const stored = localStorage.getItem(LS_KEY);
			if (stored) {
				const n = Number(stored);
				if (n >= RIGHT_PANEL_MIN && n <= RIGHT_PANEL_MAX) rightPanelWidth = n;
			}
		} catch {}

		void commandsStore.load();
	});
</script>

<div
	class="app-shell"
	class:mode-collapsed={layoutMode === 'collapsed'}
	class:mode-mobile={layoutMode === 'mobileOverlay'}
	class:has-right-panel={rightPanelInlineOpen}
	class:is-resizing={isDragging}
	style={rightPanelInlineOpen ? `--right-panel-width: ${rightPanelWidth}px` : undefined}
>
	<!-- Sidebar — Quire md surface (bound editorial sheet, no blur) -->
	<aside class="sidebar quire-md" aria-label="Navigation sidebar">
		{@render sidebar?.()}
	</aside>

	<!-- Main area: topbar + content. -->
	<div class="main-area">
		<header class="topbar quire-sm" aria-label="Application toolbar">
			{@render topbar?.()}
		</header>
		<main class="content texture-noise">
			{@render children?.()}
		</main>
	</div>

	<!-- Right panel — optional 3rd inline column. Only rendered on desktop. -->
	{#if rightPanelInlineOpen}
		<aside
			class="right-panel"
			aria-label="Session panel"
		>
			<!-- Drag handle — sits on the left edge of the panel -->
			<div
				class="resize-handle"
				role="separator"
				aria-label="Resize session panel"
				aria-orientation="vertical"
				onmousedown={startResize}
			></div>
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

	/* Single fluid indigo ambient field. Pre-resolved to rgba so the GPU
	   compositor doesn't recompute oklch color-mix on every frame. The
	   pseudo-element is promoted to its own compositing layer via
	   will-change so the browser never re-paints it during grid transitions. */
	.app-shell::before {
		content: '';
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 0;
		will-change: transform;
		background:
			radial-gradient(
				ellipse 1400px 1000px at 50% -5%,
				rgba(64, 73, 225, 0.18) 0%,
				rgba(64, 73, 225, 0.10) 25%,
				rgba(64, 73, 225, 0.04) 55%,
				transparent 85%
			),
			radial-gradient(
				ellipse 900px 700px at 15% 35%,
				rgba(64, 73, 225, 0.10) 0%,
				rgba(64, 73, 225, 0.04) 45%,
				transparent 80%
			),
			radial-gradient(
				ellipse 700px 600px at 85% 15%,
				rgba(64, 73, 225, 0.08) 0%,
				rgba(64, 73, 225, 0.03) 45%,
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
		height: 100vh;
		height: 100dvh;
		position: relative;
		z-index: var(--z-sticky);
		transition: width var(--transition-spring);
		will-change: transform;
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

	/* Right panel column — sits at column 3 / 4. */
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
		will-change: transform;
	}

	/* Drag handle — a 5px invisible hit zone on the left edge of the panel.
	   The visible 1px line is the panel's border-left; this element sits
	   on top of it so the cursor changes to col-resize without a second
	   visual bar appearing. */
	.resize-handle {
		position: absolute;
		left: -3px;
		top: 0;
		bottom: 0;
		width: 7px;
		cursor: col-resize;
		z-index: calc(var(--z-sticky) + 1);
		/* Subtle hover affordance — a faint indigo tint on the hairline */
		transition: background-color var(--duration-fast) var(--ease-out-expo);
	}

	.resize-handle:hover {
		background-color: rgba(64, 73, 225, 0.30);
	}

	/* While dragging: disable text selection, kill the spring transition
	   so the panel tracks the cursor without lag, and switch cursor. */
	.app-shell.is-resizing {
		cursor: col-resize;
		user-select: none;
		transition: none;
	}

	.app-shell.is-resizing * {
		pointer-events: none;
	}

	/* The handle itself still needs pointer events while dragging */
	.app-shell.is-resizing .resize-handle {
		pointer-events: auto;
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
