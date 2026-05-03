<!--
@component
ResearchView — top-level surface for the Research Base reader.

Two-pane layout:
  • Left  (320 px) → TreePane: search + folder tree, replaces with a flat
    result list while the search query is non-empty.
  • Right (fluid)  → ReaderPane: sticky header + frontmatter pill-bar +
    rendered HTML body + table of contents.

The view subscribes to the active project's ID via `projectsStore`. Each
time the project changes, the store is reset and the tree is re-fetched.
The store is module-scoped (singleton), so navigating away and back
preserves the last-opened file across the session — desired UX, mirrors
SpecModeView's behavior with workflows.

At viewport ≤640 px the tree pane is hidden inline; a "Files" button in
the top bar opens it as a sliding drawer (MobileTreeDrawer). Keyboard
navigation (j/k, /, g r, Enter, Escape) is bound globally while the view
is mounted via `keyboard.ts`.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { researchStore } from './research-store.svelte.js';
	import TreePane from './TreePane.svelte';
	import ReaderPane from './ReaderPane.svelte';
	import MobileTreeDrawer from './MobileTreeDrawer.svelte';
	import { handleResearchKeydown } from './keyboard.js';

	const projectId = $derived(projectsStore.activeProjectId);

	let isMobile = $state(false);
	let drawerOpen = $state(false);

	// Track which tree row is "focused" for j/k navigation. We store the
	// flat path of selectables so the handler can advance the index
	// without TreePane needing to expose its internal model. Empty until
	// the tree resolves.
	let treeRowOrder = $state<string[]>([]);
	let treeRowIndex = $state<number>(-1);

	// Load the tree whenever the active project changes. Reset clears any
	// state from a prior project so we don't briefly flash that project's
	// selected file before the new tree resolves.
	$effect(() => {
		const id = projectId;
		if (!id) {
			researchStore.reset();
			return;
		}
		if (researchStore.loadedForProjectId !== id) {
			researchStore.reset();
			void researchStore.loadTree(id);
		}
	});

	// Recompute the j/k navigation order from the live tree. Searches
	// flatten to the result list while a query is active; otherwise we
	// walk every section's files in display order. Done as a $derived
	// so the order stays in sync with `researchStore`.
	$effect(() => {
		const q = researchStore.searchQuery.trim();
		if (q) {
			treeRowOrder = researchStore.searchResults.map((r) => r.path);
		} else {
			const out: string[] = [];
			for (const section of researchStore.tree?.sections ?? []) {
				for (const file of section.files) out.push(file.path);
			}
			treeRowOrder = out;
		}
		// Reset the cursor when the underlying list shrinks past it.
		if (treeRowIndex >= treeRowOrder.length) {
			treeRowIndex = treeRowOrder.length > 0 ? 0 : -1;
		}
	});

	function motionDuration(base: number): number {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return base;
		}
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : base;
	}

	function isInputFocused(): boolean {
		const active = document.activeElement;
		if (!active) return false;
		const tag = active.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
		// `contenteditable` elements behave like inputs for typing.
		const editable = (active as HTMLElement).isContentEditable;
		return editable === true;
	}

	function focusFirstSearch(): void {
		const root = document.querySelector<HTMLElement>('[data-research-search]');
		root?.focus();
	}

	function focusReader(): void {
		const root = document.querySelector<HTMLElement>('[data-research-reader]');
		root?.focus({ preventScroll: false });
	}

	function moveTreeFocus(delta: 1 | -1): void {
		if (treeRowOrder.length === 0) return;
		const next = treeRowIndex < 0
			? (delta === 1 ? 0 : treeRowOrder.length - 1)
			: Math.min(
				treeRowOrder.length - 1,
				Math.max(0, treeRowIndex + delta),
			);
		treeRowIndex = next;
		// Scroll the visually-focused row into view if it has rendered
		// a sibling element in TreePane. Optional — not all tree rows
		// expose a stable selector, so we don't fail loudly on a miss.
		const path = treeRowOrder[next];
		const row = document.querySelector<HTMLElement>(
			`[data-research-tree-row="${CSS.escape(path)}"]`,
		);
		row?.scrollIntoView({ block: 'nearest' });
	}

	function openTreeFocus(): void {
		if (!projectId) return;
		const path = treeRowOrder[treeRowIndex];
		if (!path) return;
		void researchStore.openFile(projectId, path);
	}

	function handleViewKeydown(event: KeyboardEvent): void {
		const action = handleResearchKeydown(event, {
			isInputFocused: isInputFocused(),
		});
		if (!action) return;

		switch (action.type) {
			case 'tree-next':
				event.preventDefault();
				moveTreeFocus(1);
				break;
			case 'tree-prev':
				event.preventDefault();
				moveTreeFocus(-1);
				break;
			case 'tree-open':
				event.preventDefault();
				openTreeFocus();
				break;
			case 'focus-search':
				event.preventDefault();
				if (isMobile) drawerOpen = true;
				// The drawer mounts the search input; defer one frame so
				// the element exists before we try to focus it.
				requestAnimationFrame(focusFirstSearch);
				break;
			case 'focus-reader':
				event.preventDefault();
				focusReader();
				break;
			case 'close-drawer':
				if (drawerOpen) {
					event.preventDefault();
					drawerOpen = false;
				}
				break;
		}
	}

	onMount(() => {
		function syncIsMobile(): void {
			const next = window.innerWidth <= 640;
			if (next !== isMobile) {
				isMobile = next;
				if (!next) drawerOpen = false;
			}
		}
		syncIsMobile();
		window.addEventListener('resize', syncIsMobile);
		return () => window.removeEventListener('resize', syncIsMobile);
	});
</script>

<svelte:window onkeydown={handleViewKeydown} />

{#if !projectId}
	<div class="research-no-project">
		<p>Open a project to view its Research Base.</p>
	</div>
{:else}
	<div
		class="research-view"
		class:research-view--mobile={isMobile}
		data-testid="research-view"
		in:fade={{ duration: motionDuration(150) }}
	>
		{#if isMobile}
			<header class="research-mobile-bar">
				<button
					type="button"
					class="research-files-trigger"
					onclick={() => (drawerOpen = true)}
					aria-haspopup="dialog"
					aria-expanded={drawerOpen}
					aria-label="Open research files"
				>
					<span class="trigger-icon" aria-hidden="true">≡</span>
					<span class="trigger-label">Files</span>
				</button>
			</header>
		{:else}
			<aside class="research-tree-pane">
				<TreePane {projectId} />
			</aside>
		{/if}
		<main class="research-reader-pane" data-research-reader tabindex="-1">
			<ReaderPane {projectId} />
		</main>
	</div>

	{#if isMobile && drawerOpen}
		<MobileTreeDrawer {projectId} onClose={() => (drawerOpen = false)} />
	{/if}
{/if}

<style>
	.research-no-project {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-6);
		background-color: var(--surface-substrate);
	}

	.research-no-project p {
		font-family: var(--font-sans);
		font-size: var(--font-sans);
		color: var(--text-meta);
		margin: 0;
	}

	/*
	 * Two-pane grid. Tree pane is a fixed 320px column; reader takes the
	 * remainder. `position: absolute; inset: 0` mirrors the pattern used by
	 * other top-level views (see scroll-fix decision in memory) so the grid
	 * tracks resolve from the AppShell's content positioned container.
	 */
	.research-view {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		gap: 0;
		background-color: var(--surface-substrate);
		overflow: hidden;
	}

	.research-tree-pane,
	.research-reader-pane {
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: hidden;
	}

	/* Reader pane needs explicit focus outline reset because it carries
	   tabindex="-1" for the `g r` keyboard binding to focus into it
	   programmatically. The visible focus ring is on inner controls. */
	.research-reader-pane:focus {
		outline: none;
	}

	/* Mobile layout: single column, top bar with the Files trigger,
	   reader fills the rest. The drawer slides in over both. */
	.research-view--mobile {
		grid-template-columns: 1fr;
		grid-template-rows: 48px 1fr;
	}

	.research-mobile-bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 0 var(--space-3);
		border-bottom: 1px solid var(--border-hairline);
		background-color: var(--surface-plate);
	}

	.research-files-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
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

	.research-files-trigger:hover {
		background-color: var(--surface-hover);
		border-color: var(--border-emphasis);
	}

	.research-files-trigger:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.trigger-icon {
		font-size: var(--font-size-md);
		line-height: 1;
	}

	.trigger-label {
		font-weight: var(--font-weight-medium);
	}

	@media (max-width: 640px) {
		/* Inline tree pane is hidden on mobile (drawer takes over).
		   Kept as a safety net in case the JS-driven mobile switch
		   hasn't hydrated on first paint. */
		.research-view:not(.research-view--mobile) .research-tree-pane {
			display: none;
		}
	}
</style>
