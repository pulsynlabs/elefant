<script lang="ts">
	/**
	 * MoreNavSheet — secondary navigation surface for mobile.
	 *
	 * Slides up from the bottom of the viewport when the "More" tab in
	 * MobileBottomNav is tapped. Hosts secondary destinations that don't
	 * earn a permanent slot in the bottom nav: Agents, Runs, Worktrees,
	 * Spec Mode, Research, About.
	 *
	 * Spec: MH3.
	 *
	 * Pattern: rendered as fixed-position siblings (backdrop + sheet) with
	 * an {#if} gate driven by the parent's `open` prop. Mirrors the existing
	 * mobile-drawer pattern in App.svelte for visual / interaction
	 * consistency. Backdrop is a `<button>` so it gets native click
	 * semantics + a11y for free; tabindex="-1" keeps it out of tab order
	 * so keyboard users close via Escape (handled by the consumer).
	 *
	 * Touch targets: each row is min 44×44px (rendered ~52px tall to feel
	 * native and give thumb breathing room above the home indicator).
	 *
	 * Active state: when the current view matches a row, the row uses
	 * --surface-leaf bg and --color-primary icon — same vocabulary as
	 * the bottom nav so the two surfaces feel like one system.
	 */
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import {
		HugeiconsIcon,
		AgentsIcon,
		RunsIcon,
		WorktreesIcon,
		SpecModeIcon,
		ResearchIcon,
		AboutIcon,
	} from '$lib/icons/index.js';

	type SecondaryView =
		| 'agent-config'
		| 'agent-runs'
		| 'worktrees'
		| 'spec-mode'
		| 'research'
		| 'about';

	type Props = {
		open?: boolean;
		onClose?: () => void;
	};

	let { open = false, onClose }: Props = $props();

	const secondaryItems: { id: SecondaryView; label: string; icon: typeof AgentsIcon }[] = [
		{ id: 'agent-config', label: 'Agents', icon: AgentsIcon },
		{ id: 'agent-runs', label: 'Runs', icon: RunsIcon },
		{ id: 'worktrees', label: 'Worktrees', icon: WorktreesIcon },
		{ id: 'spec-mode', label: 'Spec Mode', icon: SpecModeIcon },
		{ id: 'research', label: 'Research', icon: ResearchIcon },
		{ id: 'about', label: 'About', icon: AboutIcon },
	];

	async function navigate(view: SecondaryView): Promise<void> {
		// Light haptic on navigation — same affordance as bottom-nav tap.
		// See MobileBottomNav.svelte for rationale on the dynamic-specifier
		// + @ts-expect-error pattern (module lives in `mobile/`, not
		// `desktop/`, so the desktop tsconfig doesn't resolve it).
		try {
			const moduleName = '@capacitor/haptics';
			const mod = await import(/* @vite-ignore */ moduleName);
			await mod.Haptics.impact({ style: mod.ImpactStyle.Light });
		} catch {
			/* no-op outside Capacitor */
		}
		navigationStore.navigate(view);
		onClose?.();
	}

	// Body scroll lock while sheet is open — mirrors the mobile-drawer
	// behavior in App.svelte. The cleanup function restores the previous
	// overflow value, which handles unmount-while-open correctly.
	$effect(() => {
		if (open) {
			const previous = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = previous;
			};
		}
	});

	// Escape key closes the sheet — the consumer can also pass a backdrop
	// onClick, but Escape is the universal "get me out" affordance.
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			event.stopPropagation();
			onClose?.();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- Backdrop scrim — semi-transparent overlay between page content
	     and the sheet. Uses var(--z-modal) - 1 so the sheet (at --z-modal)
	     paints above it. -->
	<button
		type="button"
		class="more-backdrop"
		onclick={onClose}
		aria-label="Close menu"
		tabindex="-1"
	></button>

	<!-- Sheet itself. role="dialog" + aria-modal="true" announces this as
	     a modal surface; aria-label gives screen readers a name to read.
	     The drag handle is decorative (visual affordance only — gesture
	     dismissal is a Wave 6 polish task). -->
	<div
		class="more-sheet"
		role="dialog"
		aria-modal="true"
		aria-label="More navigation"
	>
		<div class="sheet-handle" aria-hidden="true"></div>
		<nav class="sheet-nav" aria-label="Secondary navigation">
			{#each secondaryItems as item (item.id)}
				<button
					type="button"
					class="sheet-item"
					class:active={navigationStore.current === item.id}
					onclick={() => navigate(item.id)}
					aria-current={navigationStore.current === item.id ? 'page' : undefined}
				>
					<span class="item-icon" aria-hidden="true">
						<HugeiconsIcon icon={item.icon} size={20} />
					</span>
					<span class="item-label">{item.label}</span>
				</button>
			{/each}
		</nav>
	</div>
{/if}

<style>
	.more-backdrop {
		position: fixed;
		inset: 0;
		z-index: calc(var(--z-modal) - 1);
		background: rgb(0 0 0 / 0.45);
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		animation: backdrop-fade-in var(--duration-base) var(--ease-out-expo) forwards;
	}

	@keyframes backdrop-fade-in {
		from { opacity: 0; }
		to   { opacity: 1; }
	}

	.more-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: var(--z-modal);
		background-color: var(--surface-plate);
		border-top: 1px solid var(--border-edge);
		/* Rounded top corners — sets the sheet apart from the bottom nav
		   it slides over. Matches the app's --radius-fold token used by
		   other large folded surfaces (overlays, modals). */
		border-top-left-radius: var(--radius-fold);
		border-top-right-radius: var(--radius-fold);
		/* Allow content to scroll if list grows beyond the viewport, but
		   cap the sheet at 80% of the dynamic viewport so the content
		   below remains visible. */
		max-height: 80dvh;
		overflow-y: auto;
		/* Padding-bottom: bottom-nav height (so the sheet sits above the
		   nav) + a touch of breathing room. The nav itself is rendered
		   underneath this sheet because the sheet uses --z-modal and the
		   nav uses --z-sticky. */
		padding-bottom: calc(var(--bottom-nav-height) + var(--space-2));
		animation: sheet-slide-up var(--duration-base) var(--ease-out-expo) forwards;
		/* Subtle elevation so the sheet reads as floating above the nav. */
		box-shadow: var(--shadow-lg);
	}

	@keyframes sheet-slide-up {
		from { transform: translateY(100%); }
		to   { transform: translateY(0); }
	}

	@media (prefers-reduced-motion: reduce) {
		.more-backdrop,
		.more-sheet {
			animation: none;
		}
	}

	.sheet-handle {
		width: 36px;
		height: 4px;
		border-radius: var(--radius-full);
		background-color: var(--border-edge);
		margin: var(--space-3) auto var(--space-2);
	}

	.sheet-nav {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3) var(--space-3);
	}

	.sheet-item {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-plate);
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-meta);
		transition:
			background-color var(--duration-base) var(--ease-out-expo),
			color var(--duration-base) var(--ease-out-expo);
		/* Touch target ≥44×44px. */
		min-height: 44px;
		text-align: left;
		-webkit-tap-highlight-color: transparent;
		font: inherit;
	}

	.sheet-item:hover {
		background-color: var(--surface-hover);
		color: var(--text-prose);
	}

	.sheet-item:active,
	.sheet-item.active {
		background-color: var(--surface-leaf);
		color: var(--text-prose);
	}

	.sheet-item:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.item-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--text-muted);
		transition: color var(--duration-base) var(--ease-out-expo);
	}

	.sheet-item.active .item-icon {
		color: var(--color-primary);
	}

	.item-label {
		font-size: var(--font-size-sm, 14px);
		font-weight: 500;
		line-height: 1.2;
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet-item,
		.item-icon {
			transition: none;
		}
	}
</style>
