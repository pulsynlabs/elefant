<script lang="ts">
	import GeneralSettings from './GeneralSettings.svelte';
	import ProviderSettings from './ProviderSettings.svelte';
	import ServersSettings from './ServersSettings.svelte';
	import ProjectSettings from './ProjectSettings.svelte';
	import MCPSettings from './MCPSettings.svelte';
	import ServeSettings from './ServeSettings.svelte';
	import ResearchBaseTab from './ResearchBaseTab.svelte';

	type Section =
		| 'general'
		| 'providers'
		| 'mcp'
		| 'daemon'
		| 'serve'
		| 'project'
		| 'research';

	let activeSection = $state<Section>('general');

	const sections: Array<{ id: Section; label: string }> = [
		{ id: 'general', label: 'General' },
		{ id: 'project', label: 'Project' },
		{ id: 'providers', label: 'Providers' },
		{ id: 'research', label: 'Research Base' },
		{ id: 'mcp', label: 'MCP' },
		{ id: 'daemon', label: 'Servers' },
		{ id: 'serve', label: 'Serve' },
	];
</script>

<div class="settings-view">
	<div class="settings-header">
		<h2 class="settings-title industrial-caps">Settings</h2>
	</div>

	<div class="settings-layout">
		<nav class="settings-nav" aria-label="Settings sections">
			{#each sections as section}
				<button
					class="settings-nav-item mono-label"
					class:active={activeSection === section.id}
					onclick={() => (activeSection = section.id)}
					aria-current={activeSection === section.id ? 'page' : undefined}
				>
					{section.label}
				</button>
			{/each}
		</nav>

		<div class="settings-content">
			{#if activeSection === 'general'}
				<GeneralSettings />
			{:else if activeSection === 'project'}
				<ProjectSettings />
			{:else if activeSection === 'providers'}
				<ProviderSettings />
			{:else if activeSection === 'research'}
				<ResearchBaseTab />
			{:else if activeSection === 'mcp'}
				<MCPSettings />
			{:else if activeSection === 'daemon'}
				<ServersSettings />
			{:else if activeSection === 'serve'}
				<ServeSettings />
			{/if}
		</div>
	</div>
</div>

<style>
	.settings-view {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		background-color: var(--color-bg);
	}

	.settings-header {
		padding: var(--space-5) var(--space-6);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-surface);
		flex-shrink: 0;
	}

	.settings-title {
		font-size: var(--font-size-xs);
		font-family: var(--font-mono);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}

	.settings-layout {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.settings-nav {
		width: 180px;
		flex-shrink: 0;
		padding: var(--space-4) var(--space-3);
		border-right: 1px solid var(--color-border);
		background-color: var(--color-surface);
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
	}

	.settings-nav-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		transition:
			color var(--duration-fast) var(--ease-out-expo),
			background-color var(--duration-fast) var(--ease-out-expo),
			box-shadow var(--duration-fast) var(--ease-out-expo),
			transform var(--duration-fast) var(--ease-spring);
	}

	.settings-nav-item:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
		transform: translateX(2px);
	}

	.settings-nav-item.active {
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
		font-weight: var(--font-weight-medium);
		box-shadow: inset 2px 0 0 var(--color-primary);
		transform: translateX(2px);
	}

	.settings-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-6);
	}

	/* ── Mobile touch targets (≥44px) ─────────────────────────────── */
	@media (max-width: 640px) {
		.settings-nav-item {
			min-height: 44px;
		}
	}

	/* ── Mobile settings: horizontal scrollable tab strip ──────────── */
	@media (max-width: 640px) {
		/* Settings header: tighter padding */
		.settings-header {
			padding: var(--space-3) var(--space-4);
		}

		/* Switch layout direction: stack vertically */
		.settings-layout {
			flex-direction: column;
			overflow: visible;
		}

		/* Nav becomes a horizontal scrollable strip */
		.settings-nav {
			width: 100%;
			flex-shrink: 0;
			flex-direction: row;
			gap: var(--space-2);
			padding: var(--space-2) var(--space-3);
			border-right: none;
			border-bottom: 1px solid var(--color-border);
			overflow-x: auto;
			overflow-y: hidden;
			/* Hide scrollbar visually but keep scrollability */
			-ms-overflow-style: none;
			scrollbar-width: none;
			min-height: unset;
		}

		.settings-nav::-webkit-scrollbar {
			display: none;
		}

		/* Tabs become horizontal pills */
		.settings-nav-item {
			flex-shrink: 0;
			width: auto;
			white-space: nowrap;
			padding: var(--space-2) var(--space-4);
			border-radius: var(--radius-full);
			font-size: var(--font-size-sm);
			/* Keep ≥44px for WCAG 2.5.5 / MH3 touch target compliance */
			min-height: 44px;
			/* Remove the inset left border from desktop active state */
			transform: none !important;
		}

		/* Active tab: filled pill */
		.settings-nav-item.active {
			box-shadow: none;
			background-color: var(--color-primary);
			color: #fff;
			font-weight: var(--font-weight-medium);
		}

		/* Content fills remaining space */
		.settings-content {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding: var(--space-4);
		}
	}
</style>
