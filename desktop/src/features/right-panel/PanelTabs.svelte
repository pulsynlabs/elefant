<script lang="ts" module>
	import type { IconSvgElement } from '$lib/icons/index.js';

	/**
	 * Stable tab identifiers for the right panel. Kept as a literal union
	 * so consumers (persistence store, parent component) get strict typing
	 * without a runtime registry. Order here is purely declaration order;
	 * the visual order is controlled by the `tabs` array passed in.
	 */
	export type TabId = 'mcp' | 'terminal' | 'files' | 'todos';

	export type PanelTabDescriptor = {
		id: TabId;
		label: string;
		icon: IconSvgElement;
	};
</script>

<script lang="ts">
	import { HugeiconsIcon, CloseIcon } from '$lib/icons/index.js';

	type Props = {
		/** Tab descriptors in display order. */
		tabs: ReadonlyArray<PanelTabDescriptor>;
		/** Currently selected tab id. */
		activeTab: TabId;
		/** Fired when the user activates a different tab. */
		onTabChange: (tab: TabId) => void;
		/** Fired when the user clicks the close affordance. */
		onClose?: () => void;
	};

	let { tabs, activeTab, onTabChange, onClose }: Props = $props();

	// Refs to each tab button so keyboard nav can move focus to the
	// newly-activated tab. Indexed by tab id for O(1) lookup.
	const tabRefs: Record<string, HTMLButtonElement | null> = $state({});

	function activateAt(index: number) {
		const wrapped = ((index % tabs.length) + tabs.length) % tabs.length;
		const next = tabs[wrapped];
		if (!next || next.id === activeTab) return;
		onTabChange(next.id);
		// Defer focus until DOM updates so the new tab is actually focusable.
		queueMicrotask(() => tabRefs[next.id]?.focus());
	}

	function handleKey(event: KeyboardEvent, index: number) {
		switch (event.key) {
			case 'ArrowRight':
				event.preventDefault();
				activateAt(index + 1);
				break;
			case 'ArrowLeft':
				event.preventDefault();
				activateAt(index - 1);
				break;
			case 'Home':
				event.preventDefault();
				activateAt(0);
				break;
			case 'End':
				event.preventDefault();
				activateAt(tabs.length - 1);
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				activateAt(index);
				break;
		}
	}
</script>

<div class="panel-tabs" role="tablist" aria-label="Session panel sections">
	<div class="tab-strip">
		{#each tabs as tab, i (tab.id)}
			{@const selected = tab.id === activeTab}
			<button
				bind:this={tabRefs[tab.id]}
				type="button"
				role="tab"
				id={`right-panel-tab-${tab.id}`}
				aria-selected={selected}
				aria-controls={`right-panel-panel-${tab.id}`}
				tabindex={selected ? 0 : -1}
				class="tab"
				class:tab-selected={selected}
				onclick={() => activateAt(i)}
				onkeydown={(event) => handleKey(event, i)}
			>
				<HugeiconsIcon icon={tab.icon} size={16} strokeWidth={1.5} />
				<span class="tab-label">{tab.label}</span>
			</button>
		{/each}
	</div>

	{#if onClose}
		<button
			type="button"
			class="tab-close"
			aria-label="Close session panel"
			onclick={() => onClose?.()}
		>
			<HugeiconsIcon icon={CloseIcon} size={14} strokeWidth={1.6} />
		</button>
	{/if}
</div>

<style>
	.panel-tabs {
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		gap: var(--space-1);
		height: var(--right-panel-header-height, 48px);
		padding: 0 var(--space-2);
		background-color: var(--surface-plate);
		border-bottom: 1px solid var(--border-edge);
		/* Sticky inside the panel's scrollable column (parent provides the
		   scroll container). Keeps the tab strip pinned while content scrolls. */
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
	}

	.tab-strip {
		display: flex;
		align-items: stretch;
		gap: var(--space-1);
		flex: 1 1 auto;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.tab-strip::-webkit-scrollbar {
		display: none;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-3);
		height: 100%;
		min-width: 0;
		font-family: inherit;
		font-size: 12px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: 0.01em;
		color: var(--text-meta);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.tab:hover:not(.tab-selected) {
		color: var(--text-prose);
		background-color: var(--surface-hover);
	}

	.tab:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
		border-radius: var(--radius-sm);
	}

	.tab-selected {
		color: var(--text-prose);
		border-bottom-color: var(--color-primary);
	}

	.tab-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tab-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin: auto 0;
		padding: 0;
		color: var(--text-meta);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		flex: 0 0 auto;
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.tab-close:hover {
		color: var(--text-prose);
		background-color: var(--surface-hover);
	}

	.tab-close:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}
</style>
