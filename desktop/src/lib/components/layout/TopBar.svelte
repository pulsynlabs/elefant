<script lang="ts">
	import { HugeiconsIcon, MenuIcon } from "$lib/icons/index.js";
	import { projectsStore } from "$lib/stores/projects.svelte.js";
	import { navigationStore } from "$lib/stores/navigation.svelte.js";

	type Props = {
		onToggleSidebar?: () => void;
		children?: import("svelte").Snippet;
	};

	let { onToggleSidebar, children }: Props = $props();

	const activeProject = $derived(projectsStore.activeProject);

	function handleSwitchProject(): void {
		navigationStore.goToProjectPicker();
	}
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

	{#if activeProject}
		<button
			type="button"
			class="project-pill"
			onclick={handleSwitchProject}
			title={activeProject.path}
			aria-label={`Switch project — currently ${activeProject.name}`}
		>
			<span class="project-pill-name">{activeProject.name}</span>
		</button>
	{/if}

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

	.project-pill {
		display: inline-flex;
		align-items: center;
		max-width: 240px;
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		padding: 2px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: transparent;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.project-pill-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-pill:hover {
		color: var(--color-primary);
		border-color: var(--color-primary);
		background-color: var(--color-primary-subtle);
	}

	.project-pill:focus-visible {
		outline: none;
		color: var(--color-primary);
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.topbar-spacer {
		flex: 1;
	}
</style>
