<script lang="ts">
	import { onMount } from "svelte";
	import AppShell from "$lib/components/layout/AppShell.svelte";
	import TopBar from "$lib/components/layout/TopBar.svelte";
	import Sidebar from "$lib/components/layout/Sidebar.svelte";
	import ChatView from "./features/chat/ChatView.svelte";
	import { themeStore } from "$lib/stores/theme.svelte.js";
	import { navigationStore } from "$lib/stores/navigation.svelte.js";
	import { connectionStore } from "$lib/stores/connection.svelte.js";
	import { settingsStore } from "$lib/stores/settings.svelte.js";

	let sidebarCollapsed = $state(false);

	function toggleSidebar() {
		sidebarCollapsed = !sidebarCollapsed;
	}

	onMount(() => {
		themeStore.init();
		settingsStore.init();
		connectionStore.start();

		return () => {
			connectionStore.stop();
		};
	});

	const currentView = $derived(navigationStore.current);
	const connStatus = $derived(connectionStore.status);
</script>

<AppShell bind:sidebarCollapsed>
	{#snippet sidebar()}
		<Sidebar collapsed={sidebarCollapsed} />
	{/snippet}

	{#snippet topbar()}
		<TopBar onToggleSidebar={toggleSidebar}>
			<div class="topbar-actions">
				<!-- Connection status indicator -->
				<div class="connection-indicator">
					<span
						class="status-dot"
						class:connected={connStatus === 'connected'}
						class:reconnecting={connStatus === 'reconnecting'}
						class:disconnected={connStatus === 'disconnected'}
					></span>
					<span class="status-text">
						{connStatus === 'connected' ? 'Connected' : connStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
					</span>
				</div>

				<button
					onclick={() => themeStore.toggle()}
					class="theme-toggle"
					aria-label="Toggle theme"
					title="Toggle theme"
				>
					{themeStore.isDark ? "☀️" : "🌙"}
				</button>
			</div>
		</TopBar>
	{/snippet}

	<!-- Content area — routed by navigation -->
	{#if currentView === 'chat'}
		<ChatView />
	{:else}
		<div class="content-placeholder">
			<div class="placeholder-inner">
				<div class="placeholder-icon">🐘</div>
				<p class="placeholder-subtitle">
					View: <strong>{currentView}</strong>
				</p>
				<p class="placeholder-tagline">Coming in next wave...</p>
			</div>
		</div>
	{/if}
</AppShell>

<style>
	.topbar-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-left: auto;
	}

	.connection-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		display: inline-block;
		background-color: var(--color-error);
	}

	.status-dot.connected {
		background-color: var(--color-success);
	}

	.status-dot.reconnecting {
		background-color: var(--color-warning);
	}

	.status-dot.disconnected {
		background-color: var(--color-error);
	}

	.status-text {
		white-space: nowrap;
	}

	.theme-toggle {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-secondary);
		font-size: 16px;
		padding: var(--space-1);
		border-radius: var(--radius-sm);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.theme-toggle:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.content-placeholder {
		padding: var(--space-6);
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.placeholder-inner {
		text-align: center;
		color: var(--color-text-muted);
	}

	.placeholder-icon {
		font-size: 48px;
		margin-bottom: var(--space-4);
	}

	.placeholder-subtitle {
		font-size: var(--font-size-md);
		color: var(--color-text-secondary);
		margin: 0;
	}

	.placeholder-tagline {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-top: var(--space-1);
	}
</style>
