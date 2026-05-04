<script lang="ts">
	/**
	 * MobileBottomNav — primary navigation surface for ≤640px viewports.
	 *
	 * Replaces the drawer/hamburger pattern with a native-feeling tab bar.
	 * 5 tabs: Chat, Projects, Models, Settings, More (sheet for secondary
	 * destinations). Rendered as a fixed-position sibling outside AppShell
	 * (in App.svelte) only when `layoutMode === 'mobileOverlay'`, so desktop
	 * is completely unaffected.
	 *
	 * Spec: MH3 (mobile bottom navigation), MH6 (touch targets, safe area).
	 *
	 * Touch targets: each tab is min 44px tall and stretches to fill ~20% of
	 * viewport width — well above the 44×44px minimum. Active state uses
	 * --color-primary (Electric Indigo) per design tokens.
	 *
	 * Haptics: tab taps fire a light impact via the centralised
	 * $lib/native/haptics wrapper (MH5). On desktop / browser builds the
	 * wrapper is a no-op — no dynamic import in this component's hot path.
	 *
	 * Safe area: padding-bottom uses env(safe-area-inset-bottom) so the nav
	 * clears the home indicator on devices that report it.
	 */
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import {
		HugeiconsIcon,
		ChatIcon,
		FolderOpenIcon,
		ModelsIcon,
		SettingsIcon,
		MoreHorizontalIcon,
	} from '$lib/icons/index.js';
	import { haptics } from '$lib/native/haptics.js';

	type Props = {
		onMoreTap?: () => void;
	};

	let { onMoreTap }: Props = $props();

	const currentView = $derived(navigationStore.current);

	// Primary tabs. The icons map to existing semantic exports in
	// $lib/icons — keeps the bottom nav consistent with the sidebar's
	// icon vocabulary so users build muscle memory across surfaces.
	const primaryTabs = [
		{ id: 'chat' as const, label: 'Chat', icon: ChatIcon },
		{ id: 'projects' as const, label: 'Projects', icon: FolderOpenIcon },
		{ id: 'models' as const, label: 'Models', icon: ModelsIcon },
		{ id: 'settings' as const, label: 'Settings', icon: SettingsIcon },
	];

	type PrimaryTabId = typeof primaryTabs[number]['id'];

	// Views that live behind the "More" sheet — used to mark More as active
	// when the user is on any secondary destination.
	const moreViews = [
		'about',
		'agent-config',
		'agent-runs',
		'worktrees',
		'spec-mode',
		'research',
	];

	function isActiveTab(tabId: PrimaryTabId): boolean {
		// 'chat' tab stays highlighted when a child run is open — child runs
		// are conceptually nested inside the chat surface even though they
		// have their own view id.
		if (tabId === 'chat') {
			return currentView === 'chat' || currentView === 'child-run';
		}
		return currentView === tabId;
	}

	const isMoreActive = $derived(moreViews.includes(currentView));

	async function handleTabTap(tabId: PrimaryTabId): Promise<void> {
		void haptics.light();
		navigationStore.navigate(tabId);
	}

	async function handleMoreTap(): Promise<void> {
		void haptics.light();
		onMoreTap?.();
	}
</script>

<nav class="mobile-bottom-nav" aria-label="Primary navigation">
	{#each primaryTabs as tab (tab.id)}
		<button
			type="button"
			class="nav-tab"
			class:active={isActiveTab(tab.id)}
			onclick={() => handleTabTap(tab.id)}
			aria-label={tab.label}
			aria-current={isActiveTab(tab.id) ? 'page' : undefined}
		>
			<span class="tab-icon" aria-hidden="true">
				<HugeiconsIcon icon={tab.icon} size={22} />
			</span>
			<span class="tab-label">{tab.label}</span>
		</button>
	{/each}

	<!-- More tab — opens the secondary-nav sheet (MoreNavSheet.svelte) via
	     the onMoreTap callback. Active when current view is a secondary
	     destination so users always see *some* tab highlighted. -->
	<button
		type="button"
		class="nav-tab"
		class:active={isMoreActive}
		onclick={handleMoreTap}
		aria-label="More"
		aria-haspopup="dialog"
		aria-expanded={isMoreActive ? 'true' : 'false'}
	>
		<span class="tab-icon" aria-hidden="true">
			<HugeiconsIcon icon={MoreHorizontalIcon} size={22} />
		</span>
		<span class="tab-label">More</span>
	</button>
</nav>

<style>
	.mobile-bottom-nav {
		/* Fixed at the bottom of the viewport, full width. Rendered as a
		   sibling outside AppShell so the shell's overflow:hidden doesn't
		   clip it and so its z-index behavior is independent of the grid. */
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: row;
		align-items: stretch;
		width: 100%;
		height: var(--bottom-nav-height);
		/* Solid plate surface with a single hairline border above —
		   visually anchors the nav as a separate UI region without
		   adding shadow weight. */
		background-color: var(--surface-plate);
		border-top: 1px solid var(--border-edge);
		/* Push interactive content above the home indicator. The total
		   height already includes the safe-area inset (see tokens.css). */
		padding-bottom: env(safe-area-inset-bottom, 0px);
		/* Sit above page content but below the modal/drawer layer so
		   the existing mobile drawer + right-panel sheet still cover
		   the nav when they open. */
		z-index: var(--z-sticky);
	}

	.nav-tab {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		/* Touch target ≥44×44px even before flex stretching. */
		min-height: 44px;
		padding: 8px 4px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-muted);
		transition: color var(--duration-base) var(--ease-out-expo);
		/* Suppress the gray tap highlight that Android/iOS WebViews paint
		   on touch — we render our own active state via .active class and
		   :active pseudo. */
		-webkit-tap-highlight-color: transparent;
		position: relative;
	}

	/* Active indicator — a 24px wide indigo bar at the top of the active
	   tab. Scales from 0 to 1 on activation so the change reads as a
	   gentle slide rather than a hard pop. */
	.nav-tab::after {
		content: '';
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%) scaleX(0);
		width: 24px;
		height: 2px;
		border-radius: 0 0 2px 2px;
		background-color: var(--color-primary);
		transition: transform var(--duration-base) var(--ease-out-expo);
	}

	.nav-tab.active {
		color: var(--color-primary);
	}

	.nav-tab.active::after {
		transform: translateX(-50%) scaleX(1);
	}

	/* Pressed state — subtle scale on the icon for tactile feedback,
	   in addition to the OS haptic. Skipped under reduced-motion. */
	.nav-tab:active .tab-icon {
		transform: scale(0.92);
	}

	/* Keyboard focus visibility — uses the existing focus-glow token so
	   it matches the rest of the app's focus treatment. */
	.nav-tab:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
		border-radius: var(--radius-sm);
	}

	.tab-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		transition: transform var(--duration-fast) var(--ease-out-expo);
	}

	.tab-label {
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.01em;
		line-height: 1;
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-tab,
		.nav-tab::after,
		.tab-icon {
			transition: none;
		}
		.nav-tab:active .tab-icon {
			transform: none;
		}
	}
</style>
