<script lang="ts">
	import { onMount } from "svelte";
	import AppShell from "$lib/components/layout/AppShell.svelte";
	import TopBar from "$lib/components/layout/TopBar.svelte";
	import Sidebar from "$lib/components/layout/Sidebar.svelte";
	import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
	import ThemeToggle from "$lib/components/ThemeToggle.svelte";
	import ApprovalPanel from "$lib/components/ApprovalPanel.svelte";
	import DesignSystemPage from "./routes/design-system/+page.svelte";
	import { themeStore } from "$lib/stores/theme.svelte.js";
	import { navigationStore } from "$lib/stores/navigation.svelte.js";
	import { connectionStore } from "$lib/stores/connection.svelte.js";
	import { settingsStore } from "$lib/stores/settings.svelte.js";
	import { projectsStore } from "$lib/stores/projects.svelte.js";
	import { registry } from "$lib/daemon/index.js";
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
	import { SpecModeView } from "./features/spec-mode/index.js";
	import { ResearchView } from "./features/research/index.js";
	import { RightPanel, RightPanelMobile, TokenBar, rightPanelStore } from "./features/right-panel/index.js";
	import MobileBottomNav from "$lib/components/layout/MobileBottomNav.svelte";
	import MoreNavSheet from "$lib/components/layout/MoreNavSheet.svelte";
	import MobileSetupWizard from "./features/mobile-setup/MobileSetupWizard.svelte";
	import { isCapacitorRuntime } from "$lib/runtime.js";

	type NavigationRuntime = typeof navigationStore & {
		initNavigation: (opts: { getActiveProjectId: () => string | null }) => void;
		goToProjectPicker: () => void;
	};

	const navigationRuntime = navigationStore as NavigationRuntime;

	type LayoutMode = 'expanded' | 'collapsed' | 'mobileOverlay';
	let layoutMode = $state<LayoutMode>('expanded');
	let drawerOpen = $state(false);
	let isDesignSystemRoute = $state(false);
	// "More" secondary-nav sheet open state (W3.T4). Lives at the App
	// level alongside drawerOpen so the bottom nav (a sibling of AppShell)
	// can drive it without prop-drilling through the shell.
	let moreSheetOpen = $state(false);

	// Right session panel (SPEC MH1, MH9, MH2). Driven by the persistence
	// store; the in-chat topbar toggle (ChatView.svelte) flips
	// `rightPanelStore.panelOpen`. We only expose the panel when a chat
	// session is actually active — without a session there is nothing
	// session-scoped to show in the tabs.
	const activeSessionId = $derived(projectsStore.activeSessionId);
	const rightPanelOpen = $derived(
		rightPanelStore.panelOpen && activeSessionId !== null,
	);

	// Whether the user has a real (non-placeholder) provider configured.
	// null = still waiting for daemon to respond
	let hasConfig = $state<boolean | null>(null);

	// Mobile setup wizard gate (W4.T4 / MH4). Shown on Capacitor builds
	// when there is no non-localhost daemon configured. Desktop and
	// browser builds NEVER see this — `isCapacitorRuntime` is false in
	// both cases. Gate is decided once during initializeDaemonConnection()
	// after settingsStore.init() reads from @capacitor/preferences, so
	// the wizard never flashes on app reopen if config already exists.
	let showMobileWizard = $state(false);

	// Captured by onMount() so the wizard's onComplete callback can
	// re-trigger the daemon initialization after writing the user's
	// chosen URL to Capacitor Preferences. Without this, the connection
	// polling loop never starts and the chat surface stays empty.
	let runDaemonInit: (() => Promise<void>) | null = null;

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

	function computeLayoutMode(width: number): LayoutMode {
		if (width <= 640) return 'mobileOverlay';
		if (width <= 900) return 'collapsed';
		return 'expanded';
	}

	function toggleSidebar(): void {
		if (layoutMode === 'mobileOverlay') {
			drawerOpen = !drawerOpen;
		} else {
			layoutMode = layoutMode === 'expanded' ? 'collapsed' : 'expanded';
		}
	}

	// Body scroll lock while the mobile drawer is open. Reactive $effect runs
	// whenever layoutMode/drawerOpen change and ensures we always restore the
	// previous overflow on cleanup (also handles unmount mid-open).
	$effect(() => {
		if (layoutMode === 'mobileOverlay' && drawerOpen) {
			const previous = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = previous;
			};
		}
	});

	// Move keyboard focus into the drawer when it opens so screen-reader and
	// keyboard users land inside the dialog. (aria-hidden on sibling content
	// is implied by aria-modal="true" for modern AT — explicit inert/aria-hidden
	// on AppShell would require prop spreading on a component that doesn't
	// accept arbitrary attributes, so we rely on aria-modal here.)
	$effect(() => {
		if (layoutMode === 'mobileOverlay' && drawerOpen) {
			requestAnimationFrame(() => {
				const drawer = document.querySelector<HTMLElement>('.mobile-drawer');
				const firstFocusable = drawer?.querySelector<HTMLElement>(
					'button, [href], input, [tabindex]:not([tabindex="-1"])',
				);
				firstFocusable?.focus();
			});
		}
	});

	onMount(() => {
		let disposed = false;

		// Initialize theme
		themeStore.init();

		function checkDesignSystemRoute(): void {
			isDesignSystemRoute = window.location.hash === "#design-system";
		}
		checkDesignSystemRoute();
		window.addEventListener("hashchange", checkDesignSystemRoute);

		navigationRuntime.initNavigation({
			getActiveProjectId: () => projectsStore.activeProjectId,
		});

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

		async function initializeDaemonConnection(): Promise<void> {
			await settingsStore.init();
			if (disposed) return;

			// Capacitor first-launch gate (W4.T4 / MH4). On Capacitor with no
			// real (non-localhost) daemon configured, render the mobile setup
			// wizard instead of starting the connection polling loop. Once
			// the wizard's onComplete fires, this function is invoked again
			// and the gate falls through. Desktop and browser builds skip
			// this branch entirely (isCapacitorRuntime is false).
			if (isCapacitorRuntime) {
				const hasRealServer = settingsStore.servers.some(
					(s) =>
						s.url &&
						!s.url.includes("localhost") &&
						!s.url.includes("127.0.0.1"),
				);
				if (!hasRealServer) {
					showMobileWizard = true;
					return;
				}
			}

			for (const server of settingsStore.servers) {
				registry.register(server);
			}

			const activeServerId = settingsStore.activeServerId ?? settingsStore.servers[0]?.id;
			if (activeServerId) {
				registry.setActive(activeServerId);
			}

			// Auto-start daemon if configured. Mobile (Capacitor) is
			// remote-only per MH7 — never spawns a local daemon process —
			// so skip this entirely on Capacitor builds even if the
			// persisted setting somehow ended up true (e.g. config
			// imported from a desktop install). Desktop/Tauri keeps the
			// existing behavior: silently ignore failures so a missing
			// daemon binary doesn't break first launch.
			if (settingsStore.autoStartDaemon && !isCapacitorRuntime) {
				daemonLifecycle.getDaemonStatus().then((status) => {
					if (status !== "running") {
						daemonLifecycle.startDaemon().catch(() => {
							// Silently ignore auto-start failures
						});
					}
				});
			}

			connectionStore.start();
			await projectsStore.loadProjects();
			if (disposed) return;
			void loadConfigWhenReady();
		}

		// Capture the initializer so the wizard's onComplete handler can
		// re-run it after persisting config — that re-entry path falls
		// through the wizard gate (real server is now present) and starts
		// the connection polling loop. Cleaned up on unmount via `disposed`.
		runDaemonInit = initializeDaemonConnection;

		void initializeDaemonConnection();

		// Keyboard shortcuts
		function handleKeydown(event: KeyboardEvent): void {
			// Close mobile drawer on Escape (highest-priority handler)
			if (event.key === 'Escape' && layoutMode === 'mobileOverlay' && drawerOpen) {
				drawerOpen = false;
				return;
			}
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

		// Responsive sidebar — three-mode layout state machine
		function handleResize(): void {
			const newMode = computeLayoutMode(window.innerWidth);
			if (newMode !== layoutMode) {
				layoutMode = newMode;
				// Auto-close drawer when leaving mobileOverlay
				if (newMode !== 'mobileOverlay') {
					drawerOpen = false;
				}
			}
		}
		window.addEventListener("resize", handleResize);
		handleResize();

		return () => {
			disposed = true;
			connectionStore.stop();
			window.removeEventListener("keydown", handleKeydown);
			window.removeEventListener("resize", handleResize);
			window.removeEventListener("hashchange", checkDesignSystemRoute);
		};
	});

	const currentView = $derived(navigationStore.current);
</script>

{#if showMobileWizard}
	<!-- Capacitor first-launch wizard (MH4). Takes precedence over the
	     main app shell so users can't navigate away mid-setup. Once the
	     wizard's onComplete fires, we clear the gate and re-run daemon
	     init so the connection store kicks off with the new URL. -->
	<MobileSetupWizard
		onComplete={async () => {
			showMobileWizard = false;
			await runDaemonInit?.();
		}}
	/>
{:else if isDesignSystemRoute}
	<DesignSystemPage />
{:else}
	<AppShell {layoutMode} {rightPanelOpen}>
		{#snippet sidebar()}
			<Sidebar collapsed={layoutMode === 'collapsed'} />
		{/snippet}

		{#snippet topbar()}
			<TopBar onToggleSidebar={toggleSidebar} {layoutMode}>
				<ConnectionStatus />
				<ThemeToggle />
			</TopBar>
		{/snippet}

		{#snippet rightPanel()}
			<!-- Real session panel. Only rendered when a session is active
			     (rightPanelOpen above already gates this), so `activeSessionId`
			     is guaranteed non-null here — the `?? ''` is a defensive
			     fallback for the type checker, never reached at runtime.
			     TokenBar reads the live token-counter store directly (W5.T2);
			     RightPanel binds the store to the active session via $effect.
			     The Context Window Visualizer (MH8/T5.4) is managed internally
			     by RightPanel; App.svelte just passes the opener callback
			     through the footer snippet. -->
			<RightPanel
				activeTab={rightPanelStore.activeTab(activeSessionId ?? '')}
				onTabChange={(tab) => rightPanelStore.setActiveTab(activeSessionId ?? '', tab)}
				onClose={() => rightPanelStore.closePanel()}
			>
				{#snippet footer(args)}
					<TokenBar onVisualizerOpen={args.onVisualizerOpen} />
				{/snippet}
			</RightPanel>
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
		{:else if projectsStore.activeProjectId === null && navigationStore.current === "projects"}
			<ProjectPickerView onProjectSelected={() => {
				navigationStore.navigate("chat");
			}} />
		{:else if projectsStore.activeProjectId === null && ["settings", "models", "about"].includes(navigationStore.current)}
			<!-- Global views work even without an active project -->
			{#if navigationStore.current === "settings"}
				<SettingsView />
			{:else if navigationStore.current === "models"}
				<ModelsView />
			{:else if navigationStore.current === "about"}
				<AboutView />
			{/if}
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
		{:else if currentView === "spec-mode"}
			<SpecModeView />
		{:else if currentView === "research"}
			<ResearchView />
		{:else if currentView === "child-run" && navigationStore.currentChildRunId !== null}
			<ChildRunView runId={navigationStore.currentChildRunId} />
		{:else}
			<div class="unknown-view">
				Unknown view: {currentView}
			</div>
		{/if}
	</AppShell>

	<!-- Mobile drawer — rendered as a sibling outside the AppShell grid so the
	     shell's overflow:hidden / overflow:clip doesn't clip it. Only mounted
	     in mobileOverlay mode. role="dialog" + aria-modal="true" implies
	     aria-hidden on sibling content for modern screen readers. -->
	{#if layoutMode === 'mobileOverlay'}
		<div
			class="mobile-drawer"
			class:drawer-open={drawerOpen}
			role="dialog"
			aria-modal="true"
			aria-label="Navigation"
			aria-hidden={!drawerOpen}
		>
			<Sidebar collapsed={false} />
		</div>
	{/if}

	<!-- Backdrop scrim. Rendered as a <button> so it has a native click handler
	     and is keyboard-accessible; tabindex="-1" keeps it out of the tab order
	     (users close via Escape). The {#if} guards mount it only while the
	     drawer is open — close animates the drawer out via transform; the
	     backdrop unmounts immediately, which is acceptable for MVP. -->
	{#if layoutMode === 'mobileOverlay' && drawerOpen}
		<button
			type="button"
			class="drawer-backdrop"
			onclick={() => { drawerOpen = false; }}
			aria-label="Close navigation"
			tabindex="-1"
		></button>
	{/if}

	<!-- Mobile right-panel bottom sheet (W6.T1 / MH10). Sibling of AppShell so
	     the shell's overflow:hidden doesn't clip the fixed sheet. Only mounted
	     in mobileOverlay mode AND when a chat session is active — the sheet
	     itself reads `rightPanelStore.panelOpen` to drive its slide-in
	     animation, so toggling closed leaves the component mounted (it slides
	     out, not unmounts) for the duration of the mobile mode. The backdrop
	     is rendered separately, only while the sheet is visually open, so a
	     closed sheet doesn't block taps on the chat content above it. -->
	{#if layoutMode === 'mobileOverlay' && activeSessionId !== null}
		<RightPanelMobile />
	{/if}

	{#if layoutMode === 'mobileOverlay' && rightPanelOpen}
		<button
			type="button"
			class="right-panel-mobile-backdrop"
			onclick={() => rightPanelStore.closePanel()}
			aria-label="Close session panel"
			tabindex="-1"
		></button>
	{/if}

	<!-- Mobile bottom navigation bar (W3.T2 / MH3). Sibling of AppShell so
	     the shell's overflow:hidden doesn't clip its fixed positioning, and
	     so its z-index is independent of the grid. Only mounted in
	     mobileOverlay mode — desktop and tablet views (>640px) use the
	     existing inline sidebar and never see this nav. The "More" tap
	     opens MoreNavSheet for secondary destinations. -->
	{#if layoutMode === 'mobileOverlay'}
		<MobileBottomNav onMoreTap={() => { moreSheetOpen = true; }} />
		<MoreNavSheet
			open={moreSheetOpen}
			onClose={() => { moreSheetOpen = false; }}
		/>
	{/if}

	<!-- Floating tool-call approval overlay (shown when daemon requests user decision) -->
	<ApprovalPanel />
{/if}

<style>
	.unknown-view {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-muted);
	}

	/* Mobile drawer shell — fixed-position sibling of AppShell. Slides in from
	   the left when drawerOpen is true. The Sidebar component is rendered
	   inside; surface styling matches the desktop sidebar (Quire md surface). */
	.mobile-drawer {
		position: fixed;
		inset: 0 auto 0 0;
		width: var(--sidebar-width);
		height: 100vh;
		height: 100dvh;
		z-index: var(--z-modal);
		background-color: var(--surface-substrate);
		border-right: 1px solid var(--border-edge);
		transform: translateX(-100%);
		transition: transform var(--transition-spring);
		overflow: hidden;
	}

	.mobile-drawer.drawer-open {
		transform: translateX(0);
	}

	/* Drawer backdrop — semi-transparent scrim sitting between the content
	   (z<20) and the drawer (--z-modal: 30). Rendered as a <button> for
	   accessibility; reset native button chrome so it looks like a plain scrim. */
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-sticky);
		background: rgb(0 0 0 / 0.45);
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		animation: drawer-backdrop-in var(--duration-base) var(--ease-out-expo) forwards;
	}

	@keyframes drawer-backdrop-in {
		from { opacity: 0; }
		to   { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.drawer-backdrop {
			animation: none;
		}
	}

	/* Right-panel mobile bottom-sheet backdrop. Same recipe as the sidebar
	   drawer-backdrop above (button-as-scrim for native click + a11y), but
	   kept under its own class so the two overlays can coexist without
	   their styles fighting. z-index sits between the page content and the
	   bottom sheet (--z-modal: 30) so backdrop taps are reachable but
	   never paint over the sheet itself. */
	.right-panel-mobile-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-sticky);
		background: rgb(0 0 0 / 0.45);
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		animation: drawer-backdrop-in var(--duration-base) var(--ease-out-expo) forwards;
	}

	@media (prefers-reduced-motion: reduce) {
		.right-panel-mobile-backdrop {
			animation: none;
		}
	}
</style>
