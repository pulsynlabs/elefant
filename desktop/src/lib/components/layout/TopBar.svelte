<script lang="ts">
	import { HugeiconsIcon, MenuIcon } from "$lib/icons/index.js";

	type Props = {
		onToggleSidebar?: () => void;
		children?: import("svelte").Snippet;
	};

	let { onToggleSidebar, children }: Props = $props();
</script>

<div class="topbar-content">
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
			color var(--transition-fast),
			background-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.sidebar-toggle:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.sidebar-toggle:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.topbar-spacer {
		flex: 1;
	}
</style>
