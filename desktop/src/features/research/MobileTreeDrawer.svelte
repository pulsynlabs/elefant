<!--
@component
MobileTreeDrawer — slide-in sheet that hosts the Research TreePane on
viewports ≤640 px.

The drawer mirrors the existing global mobile drawer pattern from
`App.svelte`:
  • Rendered conditionally so animations re-trigger on every open.
  • Backdrop is a `<button>` for native click handling and a11y.
  • Body scroll is locked while open.
  • Escape, backdrop click, and viewport resize > 640 px all close it.
  • Focus moves into the first focusable element on open.

The tree itself is the same TreePane component used by the desktop
two-pane layout, so all behavior (search, expand/collapse, file
select) is shared. The drawer auto-closes whenever the user picks a
file by watching `researchStore.selectedFile`; this keeps the close
behavior centralized rather than threading a callback through TreePane.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import TreePane from './TreePane.svelte';
	import { researchStore } from './research-store.svelte.js';

	type Props = {
		projectId: string | null;
		onClose: () => void;
	};

	let { projectId, onClose }: Props = $props();

	let drawerEl: HTMLElement | null = $state(null);

	// Snapshot the file currently shown when the drawer opens so we can
	// detect *new* selections (vs. the existing one carrying over). This
	// avoids closing the drawer immediately on mount when a file is
	// already open from a prior session.
	let baselineSelected = researchStore.selectedFile;

	$effect(() => {
		const current = researchStore.selectedFile;
		if (current !== baselineSelected && current !== null) {
			onClose();
		}
	});

	// Body scroll lock while the drawer is open. Cleanup restores the
	// previous overflow value so the host page resumes scrolling cleanly.
	$effect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	// Auto-close on resize past the mobile breakpoint — the inline
	// tree pane reappears in the two-pane layout, so the drawer is
	// redundant. Listener is added once on mount and torn down on
	// destroy by the returned cleanup function.
	onMount(() => {
		function handleResize(): void {
			if (window.innerWidth > 640) onClose();
		}
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});

	// Move focus into the drawer on open so screen readers and
	// keyboard users land inside the dialog. Mirrors the same focus
	// pattern as the App-level mobile drawer.
	$effect(() => {
		const el = drawerEl;
		if (!el) return;
		requestAnimationFrame(() => {
			const firstFocusable = el.querySelector<HTMLElement>(
				'input, button, [href], [tabindex]:not([tabindex="-1"])',
			);
			firstFocusable?.focus();
		});
	});

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<aside
	bind:this={drawerEl}
	class="research-mobile-drawer"
	role="dialog"
	aria-modal="true"
	aria-label="Research files"
>
	<header class="drawer-header">
		<h2 class="drawer-title">Files</h2>
		<button
			type="button"
			class="drawer-close"
			onclick={onClose}
			aria-label="Close research files"
		>
			Close
		</button>
	</header>
	<div class="drawer-body">
		<TreePane {projectId} />
	</div>
</aside>

<button
	type="button"
	class="research-drawer-backdrop"
	onclick={onClose}
	aria-label="Close research files"
	tabindex="-1"
></button>

<style>
	.research-mobile-drawer {
		position: fixed;
		inset: 0 0 0 0;
		max-width: 90vw;
		width: 320px;
		z-index: var(--z-modal);
		background-color: var(--surface-substrate);
		border-right: 1px solid var(--border-edge);
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		animation: drawer-slide-in var(--duration-base) var(--ease-out-expo) forwards;
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border-hairline);
		background-color: var(--surface-plate);
		min-height: 48px;
	}

	.drawer-title {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-meta);
	}

	.drawer-close {
		min-height: 44px;
		min-width: 44px;
		padding: 0 var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		color: var(--text-prose);
		background: transparent;
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-out-expo),
			border-color var(--duration-fast) var(--ease-out-expo);
	}

	.drawer-close:hover {
		background-color: var(--surface-hover);
		border-color: var(--border-emphasis);
	}

	.drawer-close:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.drawer-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.research-drawer-backdrop {
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

	@keyframes drawer-slide-in {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(0);
		}
	}

	@keyframes drawer-backdrop-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.research-mobile-drawer,
		.research-drawer-backdrop {
			animation: none;
		}
	}
</style>
