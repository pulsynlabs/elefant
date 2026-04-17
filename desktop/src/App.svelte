<script lang="ts">
	import { onMount } from "svelte";
	import AppShell from "$lib/components/layout/AppShell.svelte";
	import TopBar from "$lib/components/layout/TopBar.svelte";
	import Sidebar from "$lib/components/layout/Sidebar.svelte";
	import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
	import ThemeToggle from "$lib/components/ThemeToggle.svelte";
	import { themeStore } from "$lib/stores/theme.svelte.js";
	import { navigationStore } from "$lib/stores/navigation.svelte.js";
	import { connectionStore } from "$lib/stores/connection.svelte.js";
	import { settingsStore } from "$lib/stores/settings.svelte.js";
	import { chatStore } from "./features/chat/chat.svelte.js";
	import { daemonLifecycle } from "$lib/services/daemon-lifecycle.js";
	import { configService } from "$lib/services/config-service.js";
	import { SHORTCUTS, matchesShortcut } from "$lib/shortcuts.js";

	// All view imports
	import ChatView from "./features/chat/ChatView.svelte";
	import SettingsView from "./features/settings/SettingsView.svelte";
	import ModelsView from "./features/models/ModelsView.svelte";
	import AboutView from "./features/about/AboutView.svelte";

	let sidebarCollapsed = $state(false);

	function toggleSidebar(): void {
		sidebarCollapsed = !sidebarCollapsed;
	}

	onMount(() => {
		// Initialize theme
		themeStore.init();

		// Initialize settings (daemon URL, auto-start preference)
		settingsStore.init();

		// Auto-start daemon if configured
		if (settingsStore.autoStartDaemon) {
			daemonLifecycle.getDaemonStatus().then((status) => {
				if (status !== "running") {
					daemonLifecycle.startDaemon().catch(() => {
						// Silently ignore auto-start failures
					});
				}
			});
		}

		// Start connection health polling
		connectionStore.start();

		// Load available providers for the chat provider selector
		configService.readConfig().then((config) => {
			if (config && config.providers.length > 0) {
				chatStore.setAvailableProviders(
					config.providers.map((p) => p.name),
					config.defaultProvider,
				);
			}
		});

		// Keyboard shortcuts
		function handleKeydown(event: KeyboardEvent): void {
			for (const shortcut of SHORTCUTS) {
				if (matchesShortcut(event, shortcut)) {
					if (shortcut.action === "settings") {
						event.preventDefault();
						navigationStore.navigate("settings");
					} else if (shortcut.action === "new-chat") {
						event.preventDefault();
						chatStore.clearConversation();
						navigationStore.navigate("chat");
					}
				}
			}
		}

		window.addEventListener("keydown", handleKeydown);

		// Responsive sidebar
		function handleResize(): void {
			if (window.innerWidth < 900) {
				sidebarCollapsed = true;
			}
		}
		window.addEventListener("resize", handleResize);
		handleResize();

		return () => {
			connectionStore.stop();
			window.removeEventListener("keydown", handleKeydown);
			window.removeEventListener("resize", handleResize);
		};
	});

	const currentView = $derived(navigationStore.current);
</script>

<AppShell bind:sidebarCollapsed>
	{#snippet sidebar()}
		<Sidebar collapsed={sidebarCollapsed} />
	{/snippet}

	{#snippet topbar()}
		<TopBar onToggleSidebar={toggleSidebar}>
			<ConnectionStatus />
			{#if chatStore.selectedProvider ?? chatStore.defaultProvider}
				<span class="topbar-provider">
					{chatStore.selectedProvider ?? chatStore.defaultProvider}
				</span>
			{/if}
			<ThemeToggle />
		</TopBar>
	{/snippet}

	<!-- View routing -->
	{#if currentView === "chat"}
		<ChatView />
	{:else if currentView === "settings"}
		<SettingsView />
	{:else if currentView === "models"}
		<ModelsView />
	{:else if currentView === "about"}
		<AboutView />
	{:else}
		<div class="unknown-view">
			Unknown view: {currentView}
		</div>
	{/if}
</AppShell>

<style>
	.topbar-provider {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		padding: 2px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		white-space: nowrap;
	}

	.unknown-view {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-muted);
	}
</style>
