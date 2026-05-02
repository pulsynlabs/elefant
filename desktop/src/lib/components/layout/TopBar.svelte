<script lang="ts">
	import { HugeiconsIcon, MenuIcon } from "$lib/icons/index.js";
	import WindowControls from "./WindowControls.svelte";
	type Props = {
		onToggleSidebar?: () => void;
		children?: import("svelte").Snippet;
	};

	let { onToggleSidebar, children }: Props = $props();

	let isDesktop = $state(false);

	$effect(() => {
		isDesktop = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
	});
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

	/* ── Mobile touch targets (≥44px) ─────────────────────────────── */
	@media (max-width: 640px) {
		.sidebar-toggle {
			min-width: 44px;
			min-height: 44px;
		}
	}
</style>
