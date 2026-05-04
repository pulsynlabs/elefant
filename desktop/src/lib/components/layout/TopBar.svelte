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
	import { connectionStore } from "$lib/stores/connection.svelte.js";

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

	// W6.T2 (MH10): mobile-only right-panel toggle. The desktop equivalent
	// lives inside ChatView (floating top-right of the chat surface) and is
	// hidden via CSS at ≤640px so this topbar affordance owns the mobile
	// path. Gated on layoutMode + activeSessionId so the button never
	// appears on desktop OR without a session in scope.
	const activeSessionId = $derived(projectsStore.activeSessionId);
	const showMobilePanelToggle = $derived(
		layoutMode === 'mobileOverlay' && activeSessionId !== null,
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

	// W5.T5 (MH7): mobile-only daemon connection indicator. Shows a small
	// status dot at ≤640px so users can see at a glance whether the remote
	// daemon is reachable. Three states map to existing semantic tokens:
	//
	//   connected     → --color-success (steady)
	//   reconnecting  → --color-warning (pulsing)
	//   disconnected  → --color-error (steady)
	//
	// Desktop hides the dot via `layoutMode` because the existing
	// `<ConnectionStatus />` slot already shows a richer connection card
	// in the topbar — at mobile widths that card is suppressed for space,
	// and the dot owns the affordance.
	const showConnectionDot = $derived(layoutMode === 'mobileOverlay');
	const connectionStatus = $derived(connectionStore.status);
	const connectionLabel = $derived(
		connectionStatus === 'connected'
			? 'Connected'
			: connectionStatus === 'reconnecting'
				? 'Reconnecting'
				: 'Offline',
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

	{#if showConnectionDot}
		<span
			class="connection-dot"
			class:connected={connectionStatus === 'connected'}
			class:reconnecting={connectionStatus === 'reconnecting'}
			role="status"
			aria-live="polite"
			aria-label="Daemon {connectionLabel.toLowerCase()}"
			title="Daemon: {connectionLabel}"
		></span>
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

	/* ── Mobile connection indicator (W5.T5 / MH7) ─────────────────────
	 * Small status dot rendered at ≤640px so the user always has a
	 * visible read on whether the remote daemon is reachable. The
	 * dot itself is decorative-sized but exposed to AT via role/aria
	 * on the element. The wrapper is non-interactive (role="status"),
	 * so it doesn't count toward the touch-target audit.
	 */
	.connection-dot {
		display: inline-block;
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--color-error);
		transition: background-color var(--duration-fast) var(--ease-out-expo);
	}

	.connection-dot.connected {
		background-color: var(--color-success);
	}

	.connection-dot.reconnecting {
		background-color: var(--color-warning);
		animation: connection-dot-pulse 1.2s ease-in-out infinite;
	}

	@keyframes connection-dot-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	@media (prefers-reduced-motion: reduce) {
		.connection-dot {
			transition: none;
		}
		.connection-dot.reconnecting {
			animation: none;
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
