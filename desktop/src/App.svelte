<script lang="ts">
	import { onMount } from "svelte";
	import AppShell from "$lib/components/layout/AppShell.svelte";
	import TopBar from "$lib/components/layout/TopBar.svelte";
	import Sidebar from "$lib/components/layout/Sidebar.svelte";
	import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
	import ThemeToggle from "$lib/components/ThemeToggle.svelte";
	import ApprovalPanel from "$lib/components/ApprovalPanel.svelte";
	import LiquidGlassDefs from "$lib/components/LiquidGlassDefs.svelte";
	import { themeStore } from "$lib/stores/theme.svelte.js";
	import { navigationStore } from "$lib/stores/navigation.svelte.js";
	import { connectionStore } from "$lib/stores/connection.svelte.js";
	import { settingsStore } from "$lib/stores/settings.svelte.js";
	import { projectsStore } from "$lib/stores/projects.svelte.js";
	import { chatStore } from "./features/chat/chat.svelte.js";
	import { daemonLifecycle } from "$lib/services/daemon-lifecycle.js";
	import { configService } from "$lib/services/config-service.js";
	import { SHORTCUTS, matchesShortcut } from "$lib/shortcuts.js";

	// All view imports
	import ChatView from "./features/chat/ChatView.svelte";
	import SettingsView from "./features/settings/SettingsView.svelte";
	import ModelsView from "./features/models/ModelsView.svelte";
	import AboutView from "./features/about/AboutView.svelte";
	import OnboardingView from "./features/onboarding/OnboardingView.svelte";
	import ProjectPickerView from "./features/projects/ProjectPickerView.svelte";
	import AgentProfilesView from "./features/agent-config/AgentProfilesView.svelte";
	import AgentRunTabs from "./features/agent-runs/AgentRunTabs.svelte";
	import WorktreeListPanel from "./features/worktrees/WorktreeListPanel.svelte";
	import ChildRunView from "./features/agent-runs/ChildRunView.svelte";

	type NavigationRuntime = typeof navigationStore & {
		initNavigation: (opts: { getActiveProjectId: () => string | null }) => void;
		goToProjectPicker: () => void;
	};

	const navigationRuntime = navigationStore as NavigationRuntime;

	let sidebarCollapsed = $state(false);

	// Whether the user has a real (non-placeholder) provider configured.
	// null = still waiting for daemon to respond
	let hasConfig = $state<boolean | null>(null);

	// Re-check config whenever the daemon connection comes up
	$effect(() => {
		if (connectionStore.isConnected && hasConfig === null) {
			configService.readConfig().then((config) => {
				if (config !== null) {
					const realProviders = config.providers.filter((p) => p.apiKey !== '');
					hasConfig = realProviders.length > 0;
					if (realProviders.length > 0) {
						chatStore.setAvailableProviders(
							realProviders.map((p) => p.name),
							config.defaultProvider || realProviders[0].name,
						);
					}
				}
			});
		}
	});

	let previousActiveProjectId = $state<string | null>(null);

	$effect(() => {
		const current = projectsStore.activeProjectId;

		if (current !== null && previousActiveProjectId === null) {
			navigationStore.navigate("chat");
		} else if (current === null && previousActiveProjectId !== null) {
			navigationRuntime.goToProjectPicker();
		}

		previousActiveProjectId = current;
	});

	function toggleSidebar(): void {
		sidebarCollapsed = !sidebarCollapsed;
	}

	onMount(() => {
		// Initialize theme
		themeStore.init();

		// Initialize settings (daemon URL, auto-start preference)
		settingsStore.init();

		navigationRuntime.initNavigation({
			getActiveProjectId: () => projectsStore.activeProjectId,
		});

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

		// Load config — retries until daemon responds.
		// hasConfig stays null (loading) until we get a definitive answer from the daemon.
		async function loadConfigWhenReady(): Promise<void> {
			for (let i = 0; i < 60; i++) {
				const config = await configService.readConfig();
				if (config !== null) {
					// Daemon responded — masked keys are '••••••••' when real, '' when unconfigured
					const realProviders = config.providers.filter((p) => p.apiKey !== '');
					hasConfig = realProviders.length > 0;
					if (realProviders.length > 0) {
						chatStore.setAvailableProviders(
							realProviders.map((p) => p.name),
							config.defaultProvider || realProviders[0].name,
						);
						await projectsStore.loadProjects();
					}
					return;
				}
				await new Promise<void>((r) => setTimeout(r, 1000));
			}
			// After 60s still no daemon — show onboarding so user can add a provider
			// (the onboarding will also let them start the daemon)
			hasConfig = false;
		}
		void loadConfigWhenReady();

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

<LiquidGlassDefs />

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

	<!-- Onboarding gate: show setup flow until a real provider is configured -->
	{#if hasConfig === null}
		<!-- Still loading config — blank to avoid flash -->
	{:else if hasConfig === false}
		<OnboardingView onComplete={async () => {
			const config = await configService.readConfig();
			if (config) {
				const realProviders = config.providers.filter((p) => p.apiKey !== '');
				if (realProviders.length > 0) {
					chatStore.setAvailableProviders(
						realProviders.map((p) => p.name),
						config.defaultProvider || realProviders[0].name,
					);
					await projectsStore.loadProjects();
					hasConfig = true;
				}
			}
		}} />
	{:else if projectsStore.activeProjectId === null}
		<ProjectPickerView onProjectSelected={() => {
			navigationStore.navigate("chat");
		}} />
	{:else if currentView === "projects"}
		<ProjectPickerView />
	{:else if currentView === "chat"}
		<ChatView />
	{:else if currentView === "settings"}
		<SettingsView />
	{:else if currentView === "models"}
		<ModelsView />
	{:else if currentView === "about"}
		<AboutView />
	{:else if currentView === "agent-config"}
		<AgentProfilesView />
	{:else if currentView === "agent-runs"}
		<AgentRunTabs />
	{:else if currentView === "worktrees"}
		<WorktreeListPanel />
	{:else if currentView === "child-run" && navigationStore.currentChildRunId !== null}
		<ChildRunView runId={navigationStore.currentChildRunId} />
	{:else}
		<div class="unknown-view">
			Unknown view: {currentView}
		</div>
	{/if}
</AppShell>

<!-- Floating tool-call approval overlay (shown when daemon requests user decision) -->
<ApprovalPanel />

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
