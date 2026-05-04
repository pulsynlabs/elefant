<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		HugeiconsIcon,
		McpServerIcon,
		TerminalIcon,
		EditIcon,
		CheckSquareIcon,
	} from '$lib/icons/index.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import PanelTabs, { type PanelTabDescriptor, type TabId } from './PanelTabs.svelte';
	import FileChangesTab from './tabs/FileChangesTab.svelte';
	import TerminalTab from './tabs/TerminalTab.svelte';
	import TodosTab from './tabs/TodosTab.svelte';

	type Props = {
		/** Currently active tab — owned externally by the persistence store. */
		activeTab?: TabId;
		/** Notifies the parent when the user changes tabs. */
		onTabChange?: (tab: TabId) => void;
		/** Optional close affordance shown at the far right of the tab strip. */
		onClose?: () => void;
		/** Optional sticky footer (e.g. TokenBar). Built later in W1.T3. */
		footer?: Snippet;
	};

	let { activeTab = 'mcp', onTabChange, onClose, footer }: Props = $props();

	// Tab descriptor list. Order here defines the visible order in the strip
	// AND the keyboard cycle order. Spec MH2 default order: MCP → Terminal
	// → File Changes → Todos.
	const tabs: ReadonlyArray<PanelTabDescriptor> = [
		{ id: 'mcp', label: 'MCP', icon: McpServerIcon },
		{ id: 'terminal', label: 'Terminal', icon: TerminalIcon },
		{ id: 'files', label: 'Files', icon: EditIcon },
		{ id: 'todos', label: 'Todos', icon: CheckSquareIcon },
	];

	// Lazy mount ledger. A tab's content is rendered only after the user
	// first activates it; once mounted it's kept alive in DOM for the
	// remainder of the panel's lifetime so that internal state (terminal
	// session, scroll position, diff cursor) survives tab switches.
	// Spec MH2: "Tab content is mounted lazily on first activation; once
	// mounted, kept alive in DOM."
	const mounted: Record<TabId, boolean> = $state({
		mcp: false,
		terminal: false,
		files: false,
		todos: false,
	});

	// Mark the initial tab as mounted on first render so the panel never
	// shows a blank content area before any interaction.
	$effect(() => {
		mounted[activeTab] = true;
	});

	function handleTabChange(next: TabId) {
		mounted[next] = true;
		onTabChange?.(next);
	}
</script>

<section class="right-panel-shell" aria-label="Session panel">
	<PanelTabs
		{tabs}
		{activeTab}
		onTabChange={handleTabChange}
		{onClose}
	/>

	<div class="panel-content">
		{#each tabs as tab (tab.id)}
			{#if mounted[tab.id]}
				<div
					id={`right-panel-panel-${tab.id}`}
					role="tabpanel"
					aria-labelledby={`right-panel-tab-${tab.id}`}
					class="tab-panel"
					class:tab-panel-active={tab.id === activeTab}
					hidden={tab.id !== activeTab}
				>
					<!-- Placeholder content. Real tabs land in W3 (MCP, Files,
					     Todos) and W4 (Terminal). The structure here matches
					     the lazy-mount + keep-alive contract from MH2. -->
					{#if tab.id === 'mcp'}
						<div class="tab-placeholder">
							<HugeiconsIcon icon={McpServerIcon} size={28} strokeWidth={1.4} />
							<p>MCP</p>
						</div>
					{:else if tab.id === 'terminal'}
						{#if projectsStore.activeProjectId && projectsStore.activeSessionId}
							<TerminalTab
								projectId={projectsStore.activeProjectId}
								sessionId={projectsStore.activeSessionId}
							/>
						{:else}
							<div class="tab-placeholder">
								<HugeiconsIcon icon={TerminalIcon} size={28} strokeWidth={1.4} />
								<p>No active session</p>
							</div>
						{/if}
					{:else if tab.id === 'files'}
						<FileChangesTab />
					{:else}
						<TodosTab />
					{/if}
				</div>
			{/if}
		{/each}
	</div>

	{#if footer}
		<footer class="panel-footer">
			{@render footer()}
		</footer>
	{/if}
</section>

<style>
	.right-panel-shell {
		/* Header height token, scoped to the right panel so PanelTabs and
		   the footer can stay in lock-step. Plate (48px) matches the global
		   topbar height for visual rhythm across the shell. */
		--right-panel-header-height: 48px;
		--right-panel-footer-height: 48px;

		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background-color: var(--surface-plate);
		color: var(--text-prose);
	}

	.panel-content {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		/* Each .tab-panel manages its own scroll; this wrapper is just the
		   stacking context. Using `display: grid` with a single cell lets
		   all mounted-but-hidden panels share the same area without each
		   needing absolute positioning. */
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		overflow: hidden;
	}

	.tab-panel {
		grid-column: 1;
		grid-row: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.tab-panel[hidden] {
		/* Native [hidden] takes elements out of the layout & a11y tree;
		   keeping the rule explicit here documents the lazy-mount contract:
		   nodes stay in the DOM (preserving terminal/diff state) but are
		   visually and semantically inert when not active. */
		display: none;
	}

	.tab-placeholder {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6);
		color: var(--text-meta);
		text-align: center;
	}

	.tab-placeholder p {
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.panel-footer {
		flex: 0 0 auto;
		min-height: var(--right-panel-footer-height);
		background-color: var(--surface-plate);
		border-top: 1px solid var(--border-edge);
		/* Sticky at the bottom of the panel column. The parent .right-panel
		   in AppShell.svelte is overflow:hidden so the footer stays pinned
		   while .panel-content scrolls. */
		position: sticky;
		bottom: 0;
		z-index: var(--z-sticky);
	}
</style>
