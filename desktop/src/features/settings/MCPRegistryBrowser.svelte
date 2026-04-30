<script lang="ts">
	import type {
		McpRegistryResponse,
		RegistryEntry,
	} from '$lib/daemon/types.js';
	import { mcpService } from '$lib/services/mcp-service.js';
	import { onMount } from 'svelte';
	import MCPRegistryCard from './MCPRegistryCard.svelte';

	type Source = 'anthropic' | 'smithery' | 'bundled';

	type Props = {
		onAddEntry: (entry: RegistryEntry) => void;
		onClose: () => void;
	};

	let { onAddEntry, onClose }: Props = $props();

	const TABS: ReadonlyArray<{ id: Source; label: string }> = [
		{ id: 'anthropic', label: 'Curated' },
		{ id: 'smithery', label: 'Community' },
		{ id: 'bundled', label: 'Bundled' },
	] as const;

	let activeSource = $state<Source>('bundled');
	let entries = $state<RegistryEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Search + filter
	let searchInput = $state('');
	let debouncedQuery = $state('');
	let activeUseCase = $state<string | null>(null);

	// Smithery paging only
	let page = $state(1);
	let hasMore = $state(false);

	// Debounce search input by 300ms.
	$effect(() => {
		const v = searchInput;
		const handle = setTimeout(() => {
			debouncedQuery = v.trim();
			// Reset paging when the query changes.
			page = 1;
		}, 300);
		return () => clearTimeout(handle);
	});

	// Fetch on every meaningful input change. Tracking dependencies are read
	// inside the effect so Svelte wires them automatically.
	$effect(() => {
		void loadEntries(activeSource, debouncedQuery, page);
	});

	onMount(() => {
		// First-paint kick — the $effect above will also fire, but loading
		// here makes the initial render feel snappier.
		void loadEntries(activeSource, debouncedQuery, page);
	});

	async function loadEntries(
		source: Source,
		query: string,
		pageNum: number,
	): Promise<void> {
		loading = true;
		error = null;
		try {
			const res: McpRegistryResponse = await mcpService.fetchRegistry({
				source,
				query: query || undefined,
				page: source === 'smithery' ? pageNum : undefined,
			});
			// Daemon may return either a sectioned shape or a flat `entries[]`.
			const next: RegistryEntry[] =
				res.entries
				?? res[source]
				?? [];
			entries = next;
			hasMore = res.hasMore ?? false;
			// Reset use-case filter if it's no longer present in results.
			if (
				activeUseCase
				&& !next.some((e) => e.useCases?.includes(activeUseCase ?? ''))
			) {
				activeUseCase = null;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load registry';
			entries = [];
		} finally {
			loading = false;
		}
	}

	function selectSource(source: Source): void {
		if (source === activeSource) return;
		activeSource = source;
		page = 1;
		activeUseCase = null;
	}

	// Distinct use-cases derived from the current entry set.
	const useCases = $derived.by(() => {
		const set = new Set<string>();
		for (const entry of entries) {
			for (const use of entry.useCases ?? []) set.add(use);
		}
		return [...set].sort();
	});

	// Apply the use-case filter client-side. Search is server-side.
	const filteredEntries = $derived(
		activeUseCase
			? entries.filter((e) => e.useCases?.includes(activeUseCase ?? ''))
			: entries,
	);

	function prevPage(): void {
		if (page > 1) page = page - 1;
	}
	function nextPage(): void {
		if (hasMore) page = page + 1;
	}

	async function handleRefresh(): Promise<void> {
		try {
			await mcpService.refreshRegistry();
			await loadEntries(activeSource, debouncedQuery, page);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Refresh failed';
		}
	}
</script>

<div class="registry-browser">
	<header class="browser-header">
		<div class="title-row">
			<h4 class="title">Registry</h4>
			<div class="title-actions">
				<button class="btn-link" type="button" onclick={handleRefresh}>
					Refresh
				</button>
				<button
					class="btn-close"
					type="button"
					onclick={onClose}
					aria-label="Close registry browser"
				>
					×
				</button>
			</div>
		</div>

		<div class="tabs" role="tablist" aria-label="Registry source">
			{#each TABS as tab (tab.id)}
				<button
					class="tab"
					class:active={activeSource === tab.id}
					role="tab"
					aria-selected={activeSource === tab.id}
					onclick={() => selectSource(tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<div class="controls">
			<input
				type="search"
				class="search-input"
				placeholder="Search…"
				bind:value={searchInput}
				aria-label="Search registry"
			/>
		</div>

		{#if useCases.length > 0}
			<div class="filter-chips" role="group" aria-label="Filter by use case">
				<button
					class="chip"
					class:active={activeUseCase === null}
					type="button"
					onclick={() => (activeUseCase = null)}
				>
					All
				</button>
				{#each useCases as use (use)}
					<button
						class="chip"
						class:active={activeUseCase === use}
						type="button"
						onclick={() => (activeUseCase = use)}
					>
						{use}
					</button>
				{/each}
			</div>
		{/if}
	</header>

	<div class="browser-body">
		{#if loading}
			<div class="state">
				<div class="spinner" aria-hidden="true"></div>
				<p>Loading registry…</p>
			</div>
		{:else if error}
			<div class="state state-error">
				<p>{error}</p>
				<button
					class="btn-link"
					type="button"
					onclick={() => loadEntries(activeSource, debouncedQuery, page)}
				>
					Retry
				</button>
			</div>
		{:else if filteredEntries.length === 0}
			<div class="state">
				<p>No servers match your search.</p>
			</div>
		{:else}
			<div class="grid">
				{#each filteredEntries as entry (entry.id)}
					<MCPRegistryCard {entry} onAdd={onAddEntry} />
				{/each}
			</div>
		{/if}
	</div>

	{#if activeSource === 'smithery' && !loading && !error && entries.length > 0}
		<footer class="paging">
			<button
				class="btn-page"
				type="button"
				onclick={prevPage}
				disabled={page <= 1}
			>
				Previous
			</button>
			<span class="page-indicator">Page {page}</span>
			<button
				class="btn-page"
				type="button"
				onclick={nextPage}
				disabled={!hasMore}
			>
				Next
			</button>
		</footer>
	{/if}
</div>

<style>
	.registry-browser {
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.browser-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.title-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.btn-link {
		background: none;
		border: none;
		color: var(--color-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		cursor: pointer;
		padding: 0;
	}

	.btn-link:hover {
		text-decoration: underline;
	}

	.btn-close {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: var(--font-size-md);
		padding: var(--space-1) var(--space-2);
		line-height: 1;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn-close:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.tabs {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--color-border);
	}

	.tab {
		background: none;
		border: none;
		padding: var(--space-2) var(--space-4);
		color: var(--color-text-muted);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.tab:hover {
		color: var(--color-text-primary);
	}

	.tab.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.controls {
		display: flex;
		gap: var(--space-2);
	}

	.search-input {
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		padding: var(--space-2) var(--space-3);
		width: 100%;
		outline: none;
		transition: border-color var(--transition-fast);
	}

	.search-input:focus {
		border-color: var(--color-primary);
	}

	.filter-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.chip {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		color: var(--color-text-secondary);
		font-size: var(--font-size-xs);
		padding: 2px 10px;
		cursor: pointer;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.chip:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.chip.active {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border-color: var(--color-primary);
	}

	.browser-body {
		padding: var(--space-4) var(--space-5);
		max-height: 480px;
		overflow-y: auto;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}

	.state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-8) var(--space-4);
		text-align: center;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.state-error {
		color: var(--color-error);
	}

	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2s;
		}
	}

	.paging {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--color-border);
	}

	.btn-page {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		padding: var(--space-1) var(--space-3);
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn-page:hover:not(:disabled) {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-page:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.page-indicator {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		min-width: 80px;
		text-align: center;
	}
</style>
