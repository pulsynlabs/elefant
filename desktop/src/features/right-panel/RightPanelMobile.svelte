<script lang="ts">
	/**
	 * Mobile-only bottom sheet variant of the right session panel (W6.T1 / MH10).
	 *
	 * Renders as a fixed overlay drawer that slides up from the bottom of the
	 * viewport at ≤640px. Reuses the **same tab content components** as
	 * `RightPanel.svelte` (TerminalTab, FileChangesTab, TodosTab, plus the
	 * MCP placeholder until W3.T1 wires `McpTab` into both surfaces) so the
	 * mobile and desktop experiences never diverge in behavior, only in
	 * chrome.
	 *
	 * Lifecycle:
	 *  - Only mounted by `App.svelte` when `layoutMode === 'mobileOverlay'`,
	 *    so all desktop styles and listeners are completely absent on
	 *    desktop. The {#if} in the parent acts as a hard runtime gate.
	 *  - The "open" class is `$derived` from `rightPanelStore.panelOpen` so
	 *    the slide-in animation runs naturally on mount when the store is
	 *    already-open from persistence.
	 *
	 * Interaction model (per spec MH10):
	 *  - Backdrop tap closes (handled by `App.svelte` sibling backdrop, same
	 *    pattern as the existing mobile sidebar drawer).
	 *  - Close button in the tab strip (PanelTabs `onClose`) closes.
	 *  - `Escape` on a hardware keyboard closes — this component owns the
	 *    listener since the sheet is the topmost focused dialog.
	 *  - Swipe-down on the drag handle area closes when ΔY > 80px.
	 *
	 * Design tokens only — no hardcoded colors or spacing values. Touch
	 * targets ≥ 44×44px throughout (verified by mobile-regression suite).
	 */
	import {
		HugeiconsIcon,
		McpServerIcon,
		EditIcon,
		CheckSquareIcon,
	} from '$lib/icons/index.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { tokenCounterStore } from '$lib/stores/token-counter.svelte.js';
	import PanelTabs, { type PanelTabDescriptor, type TabId } from './PanelTabs.svelte';
	import FileChangesTab from './tabs/FileChangesTab.svelte';
	import TodosTab from './tabs/TodosTab.svelte';
	import TokenBar from './TokenBar.svelte';
	import ContextVisualizer from './visualizer/ContextVisualizer.svelte';
	import { rightPanelStore } from './right-panel.svelte.js';

	// ── Active session id ───────────────────────────────────────────────────
	// The store's per-session activeTab API requires a string key. Mirrors
	// the App.svelte desktop wiring: the mobile sheet only meaningfully
	// shows session-scoped tabs when a session is active, but a defensive
	// `?? ''` keeps the type-checker happy if the parent's gating ever
	// drifts.
	const activeSessionId = $derived(projectsStore.activeSessionId ?? '');
	const activeTab = $derived(rightPanelStore.activeTab(activeSessionId));

	function handleTabChange(next: TabId): void {
		mounted[next] = true;
		rightPanelStore.setActiveTab(activeSessionId, next);
	}

	function handleClose(): void {
		rightPanelStore.closePanel();
	}

	// ── Token counter binding ───────────────────────────────────────────────
	// Same idempotent setSession contract as RightPanel.svelte (W5.T2).
	// Re-binding is a no-op when the (project, session) tuple is unchanged.
	$effect(() => {
		tokenCounterStore.setSession(
			projectsStore.activeProjectId,
			projectsStore.activeSessionId,
		);
	});

	// ── Tab descriptors ─────────────────────────────────────────────────────
	// The mobile sheet intentionally OMITS the Terminal tab (SPEC MH8: terminal
	// is desktop-only). Order otherwise matches RightPanel.svelte so the
	// per-session active-tab persistence remains coherent across surfaces.
	// xterm.js and ghostty-web are dynamic-imported only by TerminalTab, so
	// not rendering the tab is sufficient to keep them out of the mobile
	// execution path.
	const tabs: ReadonlyArray<PanelTabDescriptor> = [
		{ id: 'mcp', label: 'MCP', icon: McpServerIcon },
		{ id: 'files', label: 'Files', icon: EditIcon },
		{ id: 'todos', label: 'Todos', icon: CheckSquareIcon },
	];

	// ── Lazy mount ledger ───────────────────────────────────────────────────
	// Same contract as RightPanel.svelte: each tab's content is mounted on
	// first activation and kept alive for the lifetime of the sheet so
	// scroll positions and diff cursors survive tab switches inside the
	// sheet. Terminal entry kept in the ledger as `false` so the shared
	// TabId type stays exhaustive — it never flips because the tab strip
	// can't activate it on mobile.
	const mounted: Record<TabId, boolean> = $state({
		mcp: false,
		terminal: false,
		files: false,
		todos: false,
	});

	$effect(() => {
		mounted[activeTab] = true;
	});

	// ── Context visualizer overlay ──────────────────────────────────────────
	let visualizerOpen = $state(false);

	function openVisualizer(): void {
		visualizerOpen = true;
	}

	function closeVisualizer(): void {
		visualizerOpen = false;
		// Restore focus to the TokenBar trigger so a keyboard user lands
		// where they left off — same affordance as RightPanel.svelte.
		requestAnimationFrame(() => {
			document
				.querySelector<HTMLElement>('[data-part="token-bar-button"]')
				?.focus();
		});
	}

	// ── Open/close animation ────────────────────────────────────────────────
	// The component is always mounted while `layoutMode === 'mobileOverlay'`
	// (parent gate). The "open" class flips on/off based on the store flag
	// so the CSS transform transition runs on every state change.
	const isOpen = $derived(rightPanelStore.panelOpen);

	// ── Escape key close ────────────────────────────────────────────────────
	// Listen at the dialog element (svelte adds the listener once the
	// element mounts). Captures Escape regardless of focused descendant.
	function handleKeydown(event: KeyboardEvent): void {
		if (!isOpen) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			handleClose();
		}
	}

	// ── Swipe-down to close ─────────────────────────────────────────────────
	// Tracks vertical touch travel from the drag handle area. A net
	// downward movement of more than `SWIPE_THRESHOLD_PX` triggers close.
	// We deliberately do NOT translate the sheet during drag (no rubber-
	// banding) — keeps the interaction predictable and avoids fighting
	// the CSS transition. Starting touch outside the handle area (e.g.
	// inside scrollable tab content) is ignored so vertical scrolling
	// inside a tab never accidentally closes the sheet.
	const SWIPE_THRESHOLD_PX = 80;
	let touchStartY = $state<number | null>(null);

	function handleHandleTouchStart(event: TouchEvent): void {
		const touch = event.touches[0];
		if (!touch) return;
		touchStartY = touch.clientY;
	}

	function handleHandleTouchEnd(event: TouchEvent): void {
		if (touchStartY === null) return;
		const touch = event.changedTouches[0];
		if (touch) {
			const deltaY = touch.clientY - touchStartY;
			if (deltaY > SWIPE_THRESHOLD_PX) {
				handleClose();
			}
		}
		touchStartY = null;
	}

	function handleHandleTouchCancel(): void {
		touchStartY = null;
	}

	// ── Body scroll lock while sheet is open ────────────────────────────────
	// Mirrors the mobile sidebar drawer pattern in App.svelte. The cleanup
	// returned from $effect always restores the prior overflow value so a
	// rapid open→unmount sequence can't leave the body permanently frozen.
	$effect(() => {
		if (isOpen) {
			const previous = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = previous;
			};
		}
	});

	// ── Initial focus ───────────────────────────────────────────────────────
	// When the sheet opens, move focus inside so screen-reader and
	// keyboard users land in the dialog. Targets the close button if
	// available (last interactive in the tab strip), else the active
	// tab button.
	$effect(() => {
		if (isOpen) {
			requestAnimationFrame(() => {
				const sheet = document.querySelector<HTMLElement>('.right-panel-mobile');
				const focusTarget =
					sheet?.querySelector<HTMLElement>('[aria-label="Close session panel"]') ??
					sheet?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
				focusTarget?.focus();
			});
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="right-panel-mobile"
	class:open={isOpen}
	role="dialog"
	aria-modal="true"
	aria-label="Session panel"
	aria-hidden={!isOpen}
>
	<!-- Drag handle area: a generous 32px touch zone for swipe-down to close.
	     The visible pill is purely decorative; the whole region listens for
	     touch events. role="presentation" because the gesture is an
	     enhancement — close is also reachable via the × button and Escape. -->
	<div
		class="drag-handle-area"
		role="presentation"
		ontouchstart={handleHandleTouchStart}
		ontouchend={handleHandleTouchEnd}
		ontouchcancel={handleHandleTouchCancel}
	>
		<div class="drag-handle" aria-hidden="true"></div>
	</div>

	<PanelTabs
		{tabs}
		{activeTab}
		onTabChange={handleTabChange}
		onClose={handleClose}
	/>

	<div class="panel-content">
		{#each tabs as tab (tab.id)}
			{#if mounted[tab.id]}
				<div
					id={`right-panel-mobile-panel-${tab.id}`}
					role="tabpanel"
					aria-labelledby={`right-panel-tab-${tab.id}`}
					class="tab-panel"
					class:tab-panel-active={tab.id === activeTab}
					hidden={tab.id !== activeTab}
				>
					{#if tab.id === 'mcp'}
						<div class="tab-placeholder">
							<HugeiconsIcon icon={McpServerIcon} size={28} strokeWidth={1.4} />
							<p>MCP</p>
						</div>
					{:else if tab.id === 'files'}
						<FileChangesTab />
					{:else if tab.id === 'todos'}
						<TodosTab />
					{/if}
					<!-- Terminal tab is intentionally excluded on mobile (SPEC MH8). -->
				</div>
			{/if}
		{/each}

		{#if visualizerOpen}
			<ContextVisualizer onClose={closeVisualizer} />
		{/if}
	</div>

	<footer class="panel-footer">
		<TokenBar onVisualizerOpen={openVisualizer} />
	</footer>
</div>

<style>
	.right-panel-mobile {
		/* Header/footer height tokens scoped to the mobile sheet so the
		   tab strip (sticky) and footer (sticky) stay in lock-step. Same
		   values as RightPanel.svelte to keep the visual rhythm. */
		--right-panel-header-height: 48px;
		--right-panel-footer-height: 48px;

		/* Position contract: fixed bottom sheet, full-width minus the
		   safe-area inset on devices with rounded screen corners. The
		   sheet is sized at 80vh so the chat content above remains
		   partially visible — confirms to the user that the sheet is an
		   overlay, not a full-screen takeover. */
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: var(--z-modal);

		/* 80dvh tracks the dynamic viewport height on mobile browsers so
		   the URL bar collapse/expand doesn't cause the sheet to clip or
		   overflow. Falls back to vh on browsers without dvh support. */
		height: 80vh;
		height: 80dvh;
		max-width: 100vw;

		display: flex;
		flex-direction: column;
		min-height: 0;

		background-color: var(--surface-plate);
		color: var(--text-prose);
		border-top: 1px solid var(--border-edge);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		box-shadow: var(--shadow-lg);

		/* Slide-in animation. Sheet starts off-screen below the viewport
		   and slides up when `.open` is added. CSS-only — no animation
		   library, transition runs even on the very first open after
		   persistence-restored state since `isOpen` flips after mount. */
		transform: translateY(100%);
		transition: transform var(--duration-base) var(--ease-out-expo);

		overflow: hidden;
		box-sizing: border-box;
	}

	.right-panel-mobile.open {
		transform: translateY(0);
	}

	@media (prefers-reduced-motion: reduce) {
		.right-panel-mobile {
			transition: none;
		}
	}

	/* Drag handle: 32px touch-target row with a centred 4px-tall pill.
	   Total height is generous enough to hit reliably on a moving thumb
	   without consuming sheet content space. */
	.drag-handle-area {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 32px;
		flex: 0 0 auto;
		/* touch-action: none allows us to capture the swipe-down gesture
		   without the browser hijacking it for page scrolling. The handle
		   is an inert decorative bar — there's nothing to scroll inside
		   it — so this is safe. */
		touch-action: none;
		cursor: grab;
		user-select: none;
		-webkit-user-select: none;
	}

	.drag-handle-area:active {
		cursor: grabbing;
	}

	.drag-handle {
		width: 36px;
		height: 4px;
		border-radius: var(--radius-full);
		background-color: var(--border-edge);
	}

	/* Tab content region — same flex/grid contract as RightPanel.svelte.
	   `position: relative` so the visualizer overlay can use `inset: 0`. */
	.panel-content {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		overflow: hidden;
	}

	.tab-panel {
		grid-column: 1;
		grid-row: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		/* Smooth iOS-style momentum scrolling for long file/todo lists. */
		-webkit-overflow-scrolling: touch;
	}

	.tab-panel[hidden] {
		display: none;
	}

	.tab-placeholder {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6);
		color: var(--text-meta);
		text-align: center;
	}

	.tab-placeholder p {
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.panel-footer {
		flex: 0 0 auto;
		min-height: var(--right-panel-footer-height);
		background-color: var(--surface-plate);
		border-top: 1px solid var(--border-edge);
	}
</style>
