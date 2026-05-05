<script lang="ts">
	import {
		HugeiconsIcon,
		MenuIcon,
		PanelRightIcon,
		PanelRightCloseIcon,
	} from "$lib/icons/index.js";
	import WindowControls from "./WindowControls.svelte";
	import { rightPanelStore } from "../../../features/right-panel/index.js";
	import { projectsStore } from "$lib/stores/projects.svelte.js";
	import { tokenCounterStore } from "$lib/stores/token-counter.svelte.js";

	type LayoutMode = 'expanded' | 'collapsed' | 'mobileOverlay';

	type Props = {
		onToggleSidebar?: () => void;
		layoutMode?: LayoutMode;
		children?: import("svelte").Snippet;
	};

	let { onToggleSidebar, layoutMode = 'expanded', children }: Props = $props();

	let isDesktop = $state(false);

	$effect(() => {
		isDesktop = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
	});

	const activeSessionId = $derived(projectsStore.activeSessionId);

	// Mobile-only right-panel toggle (bottom-sheet path).
	const showMobilePanelToggle = $derived(
		layoutMode === 'mobileOverlay' && activeSessionId !== null,
	);

	// Desktop right-panel toggle — shown whenever a session is active on
	// non-mobile layouts. Sits next to ThemeToggle in the topbar.
	const showDesktopPanelToggle = $derived(
		layoutMode !== 'mobileOverlay' && activeSessionId !== null,
	);

	// Compact context-window indicator shown when the panel sheet is closed
	// on mobile. Gives the user a quick read of context pressure without
	// having to open the bottom sheet. Tap = open the panel.
	const showTokenChip = $derived(
		showMobilePanelToggle && !rightPanelStore.panelOpen,
	);
	const windowPercentLabel = $derived(
		`${Math.round(tokenCounterStore.windowPercent * 100)}%`,
	);
</script>

<div class="topbar-content" data-tauri-drag-region>
	<button
		class="sidebar-toggle"
		onclick={onToggleSidebar}
		aria-label="Toggle sidebar"
		title="Toggle sidebar"
	>
		<HugeiconsIcon icon={MenuIcon} size={16} strokeWidth={1.5} />
	</button>

	<div class="topbar-spacer"></div>

	{@render children?.()}

	{#if showDesktopPanelToggle}
		<button
			type="button"
			class="sidebar-toggle"
			onclick={() => rightPanelStore.togglePanel()}
			aria-label="Toggle session panel"
			aria-expanded={rightPanelStore.panelOpen}
			title={rightPanelStore.panelOpen ? 'Hide session panel' : 'Show session panel'}
		>
			<HugeiconsIcon
				icon={rightPanelStore.panelOpen ? PanelRightCloseIcon : PanelRightIcon}
				size={16}
				strokeWidth={1.5}
			/>
		</button>
	{/if}

	{#if showTokenChip}
		<button
			type="button"
			class="topbar-token-chip"
			onclick={() => rightPanelStore.openPanel()}
			aria-label="Open session panel ({windowPercentLabel} of context window used)"
			title="Context window: {windowPercentLabel}"
		>
			{windowPercentLabel}
		</button>
	{/if}

	{#if showMobilePanelToggle}
		<button
			type="button"
			class="topbar-panel-toggle"
			onclick={() => rightPanelStore.togglePanel()}
			aria-label="Toggle session panel"
			aria-expanded={rightPanelStore.panelOpen}
			title={rightPanelStore.panelOpen ? 'Hide session panel' : 'Show session panel'}
		>
			<HugeiconsIcon
				icon={rightPanelStore.panelOpen ? PanelRightCloseIcon : PanelRightIcon}
				size={16}
				strokeWidth={1.5}
			/>
		</button>
	{/if}

	{#if isDesktop}
		<WindowControls />
	{:else}
		<!-- Native window decorations on non-Tauri -->
	{/if}
</div>

<style>
	.topbar-content {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
	}

	.sidebar-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out-expo),
			background-color var(--duration-fast) var(--ease-out-expo),
			box-shadow var(--duration-fast) var(--ease-out-expo);
	}

	.sidebar-toggle:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.sidebar-toggle:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	/* Spacer to push action buttons to the right */
	.topbar-spacer {
		flex: 1;
	}

	/* ── Mobile right-panel toggle ─────────────────────────────────
	 * W6.T2 (MH10). Sized to the full topbar height (48px) so the
	 * touch target naturally meets the ≥44px floor without inflating
	 * the icon — the visual icon stays at 16px to match sidebar-toggle.
	 * Only ever rendered at ≤640px (gated in script via layoutMode),
	 * so no display:none media query is required.
	 */
	.topbar-panel-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out-expo),
			background-color var(--duration-fast) var(--ease-out-expo),
			box-shadow var(--duration-fast) var(--ease-out-expo);
	}

	.topbar-panel-toggle:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.topbar-panel-toggle:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	/* ── Mobile compact token chip ─────────────────────────────────
	 * Small pill that previews context-window pressure when the panel
	 * sheet is closed. Tapping opens the panel (where the full
	 * TokenBar + Visualizer live). Touch target uses padding rather
	 * than min-height so the chip stays visually compact while still
	 * meeting the ≥44px touch target floor (the topbar is 48px tall;
	 * generous side padding plus the 48px row height keeps the
	 * effective hit area comfortable).
	 */
	.topbar-token-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0 var(--space-2);
		border-radius: var(--radius-full, 9999px);
		border: 1px solid var(--border-edge);
		background-color: var(--surface-leaf);
		color: var(--text-meta);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out-expo),
			background-color var(--duration-fast) var(--ease-out-expo),
			box-shadow var(--duration-fast) var(--ease-out-expo);
	}

	.topbar-token-chip:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.topbar-token-chip:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	@media (prefers-reduced-motion: reduce) {
		.topbar-panel-toggle,
		.topbar-token-chip {
			transition: none;
		}
	}

	/* ── Mobile touch targets (≥44px) ─────────────────────────────── */
	@media (max-width: 640px) {
		.sidebar-toggle {
			min-width: 44px;
			min-height: 44px;
		}
	}
</style>
