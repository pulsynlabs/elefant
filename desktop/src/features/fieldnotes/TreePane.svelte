<!--
@component
TreePane — left pane of the Field Notes View.

Renders the section/file hierarchy from `fieldNotesStore.tree`. Each
section is collapsible and remembers its own open/closed state in this
component (local UI state — survives only while the pane is mounted,
which matches the user expectation that sections "snap back" to defaults
on full reload).

Search is wired to the store's `search()` action with a 200ms debounce. A
non-empty query replaces the section list with a flat result list; clearing
the query restores the tree.
-->
<script lang="ts">
	import {
		HugeiconsIcon,
		SearchIcon,
		CloseIcon,
		ChevronRightIcon,
		ChevronDownIcon,
		FolderIcon,
		FieldNotesIcon,
	} from '$lib/icons/index.js';
	import { fieldNotesStore } from './fieldnotes-store.svelte.js';
	import type {
		FieldNotesTreeFile,
		FieldNotesTreeSection,
		FieldNotesSearchResult,
	} from '$lib/daemon/types.js';

	type Props = {
		projectId: string | null;
	};

	let { projectId }: Props = $props();

	let openSections = $state<Record<string, boolean>>({});
	let searchInputEl: HTMLInputElement | null = null;
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;

	const tree = $derived(fieldNotesStore.tree);
	const isLoading = $derived(fieldNotesStore.isLoading);
	const isSearching = $derived(fieldNotesStore.isSearching);
	const searchResults = $derived(fieldNotesStore.searchResults);
	const selectedFile = $derived(fieldNotesStore.selectedFile);
	const searchQuery = $derived(fieldNotesStore.searchQuery);
	const error = $derived(fieldNotesStore.error);

	const showingSearch = $derived(searchQuery.trim().length > 0);

	/**
	 * Open every section by default the first time a tree arrives — users
	 * expect to see content on first paint rather than having to expand
	 * each section manually. Subsequent re-opens (project switch) re-seed
	 * because the tree identity changes.
	 */
	$effect(() => {
		const t = tree;
		if (!t) return;
		const next: Record<string, boolean> = {};
		for (const section of t.sections) {
			next[section.name] = openSections[section.name] ?? true;
		}
		openSections = next;
	});

	function toggleSection(name: string): void {
		openSections = { ...openSections, [name]: !openSections[name] };
	}

	function selectFile(path: string): void {
		if (!projectId) return;
		void fieldNotesStore.openFile(projectId, path);
	}

	function handleSearchInput(value: string): void {
		fieldNotesStore.setSearchQuery(value);
		if (searchDebounce) clearTimeout(searchDebounce);
		const trimmed = value.trim();
		if (!trimmed || !projectId) return;
		searchDebounce = setTimeout(() => {
			void fieldNotesStore.search(projectId, trimmed);
		}, 200);
	}

	function clearSearch(): void {
		fieldNotesStore.setSearchQuery('');
		if (searchDebounce) clearTimeout(searchDebounce);
		searchInputEl?.focus();
	}

	/**
	 * Recency dot — green for fresh-today, blue for past-week, none after
	 * that. The `updated` field is an ISO-8601 string per the frontmatter
	 * schema; tolerate parse failures by returning `null` (no dot).
	 */
	function recencyDot(updated: string): 'fresh' | 'recent' | null {
		if (!updated) return null;
		const ts = Date.parse(updated);
		if (Number.isNaN(ts)) return null;
		const ageHours = (Date.now() - ts) / 3_600_000;
		if (ageHours < 24) return 'fresh';
		if (ageHours < 24 * 7) return 'recent';
		return null;
	}
</script>

<div class="tree-pane" aria-label="Field notes file tree">
	<div class="tree-search">
		<span class="search-icon" aria-hidden="true">
			<HugeiconsIcon icon={SearchIcon} size={14} strokeWidth={1.6} />
		</span>
		<input
			bind:this={searchInputEl}
			type="search"
			class="search-input"
			data-field-notes-search
			placeholder="Search Field Notes"
			aria-label="Search Field Notes"
			value={searchQuery}
			oninput={(e) => handleSearchInput(e.currentTarget.value)}
			autocomplete="off"
			spellcheck="false"
		/>
		{#if searchQuery}
			<button
				type="button"
				class="search-clear"
				aria-label="Clear search"
				onclick={clearSearch}
			>
				<HugeiconsIcon icon={CloseIcon} size={12} strokeWidth={2} />
			</button>
		{/if}
	</div>

	<div class="tree-scroll">
		{#if error}
			<p class="tree-error" role="alert">{error}</p>
		{/if}

		{#if showingSearch}
			<!-- Search-results mode: flat list replacing the section tree. -->
			{#if isSearching}
				<div class="tree-loading" aria-busy="true">
					{#each Array.from({ length: 3 }) as _, i (i)}
						<div class="skeleton-row" aria-hidden="true">
							<div class="skeleton-line skeleton-line-title"></div>
							<div class="skeleton-line skeleton-line-meta"></div>
						</div>
					{/each}
				</div>
			{:else if searchResults.length === 0}
				<p class="tree-empty">
					No matches for <span class="quoted">"{searchQuery}"</span>.
				</p>
			{:else}
				<ul class="result-list" aria-label="Search results">
					{#each searchResults as result (result.path)}
						{@const isActive = result.path === selectedFile}
						<li>
							<button
								type="button"
								class="result-row"
								class:active={isActive}
								data-field-notes-tree-row={result.path}
								onclick={() => selectFile(result.path)}
							>
								<span class="result-title">{result.title}</span>
								<span class="result-path">{result.section}</span>
								{#if result.snippet}
									<span class="result-snippet">{result.snippet}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if isLoading && !tree}
			<div class="tree-loading" aria-busy="true">
				{#each Array.from({ length: 3 }) as _, i (i)}
					<div class="skeleton-row" aria-hidden="true">
						<div class="skeleton-line skeleton-line-title"></div>
						<div class="skeleton-line skeleton-line-meta"></div>
					</div>
				{/each}
			</div>
		{:else if !tree || tree.sections.every((s) => s.files.length === 0)}
			<div class="tree-zero" role="status">
				<div class="zero-icon" aria-hidden="true">
					<HugeiconsIcon icon={FieldNotesIcon} size={20} strokeWidth={1.4} />
				</div>
				<p class="zero-headline">No field notes yet</p>
				<p class="zero-body">
					Agents will populate this as they work.
				</p>
			</div>
		{:else}
			<ul class="section-list">
				{#each tree.sections as section (section.name)}
					{@const open = openSections[section.name] ?? true}
					<li class="section-item">
						<button
							type="button"
							class="section-header"
							aria-expanded={open}
							onclick={() => toggleSection(section.name)}
						>
							<span class="section-chevron" aria-hidden="true">
								<HugeiconsIcon
									icon={open ? ChevronDownIcon : ChevronRightIcon}
									size={12}
									strokeWidth={1.6}
								/>
							</span>
							<span class="section-icon" aria-hidden="true">
								<HugeiconsIcon icon={FolderIcon} size={12} strokeWidth={1.4} />
							</span>
							<span class="section-label">{section.label}</span>
							<span class="section-count">{section.files.length}</span>
						</button>

						<!--
							CSS grid `1fr / 0fr` collapse trick — animates height
							without `max-height` magic numbers and respects the
							user's reduced-motion preference at the parent level.
						-->
						<div
							class="section-files-wrap"
							data-open={open}
						>
							<ul class="section-files">
								{#each section.files as file (file.path)}
									{@const isActive = file.path === selectedFile}
									{@const dot = recencyDot(file.updated)}
									<li>
										<button
											type="button"
											class="file-row"
											class:active={isActive}
											data-field-notes-tree-row={file.path}
											onclick={() => selectFile(file.path)}
											aria-current={isActive ? 'true' : undefined}
										>
											<span class="file-title">{file.title}</span>
											<span class="file-meta">
												{#if dot === 'fresh'}
													<span class="recency-dot fresh" title="Updated in the last 24 hours" aria-label="Fresh"></span>
												{:else if dot === 'recent'}
													<span class="recency-dot recent" title="Updated in the last 7 days" aria-label="Recent"></span>
												{/if}
												{#each file.tags.slice(0, 2) as tag (tag)}
													<span class="file-tag">{tag}</span>
												{/each}
											</span>
										</button>
									</li>
								{/each}
							</ul>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.tree-pane {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background-color: var(--surface-plate);
		border-right: 1px solid var(--border-hairline);
		overflow: hidden;
	}

	/* --- Search ---------------------------------------------------------- */
	.tree-search {
		position: relative;
		display: flex;
		align-items: center;
		padding: var(--space-3);
		border-bottom: 1px solid var(--border-hairline);
		flex-shrink: 0;
	}

	.search-icon {
		position: absolute;
		left: calc(var(--space-3) + var(--space-2));
		display: inline-flex;
		align-items: center;
		color: var(--text-muted);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 6px var(--space-3) 6px calc(var(--space-2) + 24px);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		background-color: var(--surface-leaf);
		color: var(--text-prose);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		line-height: var(--leading-snug);
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.search-input::placeholder {
		color: var(--text-muted);
	}

	.search-input:hover {
		border-color: var(--border-edge);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.search-input::-webkit-search-cancel-button {
		appearance: none;
	}

	.search-clear {
		position: absolute;
		right: calc(var(--space-3) + 6px);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: var(--radius-xs);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: background-color var(--transition-fast), color var(--transition-fast);
	}

	.search-clear:hover {
		background-color: var(--surface-hover);
		color: var(--text-prose);
	}

	.search-clear:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	/* --- Scroll container ------------------------------------------------ */
	.tree-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2) 0;
	}

	.tree-error {
		margin: var(--space-2) var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-sm);
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		color: var(--color-error);
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
	}

	/* --- Loading skeleton ------------------------------------------------ */
	.tree-loading {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
	}

	.skeleton-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.skeleton-line {
		height: 10px;
		border-radius: var(--radius-sm);
		background-color: var(--surface-hover);
		animation: skeleton-pulse 1.6s var(--ease-standard) infinite;
	}

	.skeleton-line-title { width: 75%; }
	.skeleton-line-meta { width: 35%; height: 7px; }

	@keyframes skeleton-pulse {
		0%, 100% { opacity: 0.6; }
		50% { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-line { animation: none; }
	}

	/* --- Empty / zero states -------------------------------------------- */
	.tree-empty {
		margin: var(--space-3);
		padding: var(--space-3);
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		text-align: center;
	}

	.quoted {
		color: var(--text-meta);
		font-family: var(--font-mono);
	}

	.tree-zero {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-2);
		padding: var(--space-7) var(--space-4);
	}

	.zero-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background-color: var(--color-primary-subtle);
		color: var(--color-primary);
		margin-bottom: var(--space-1);
	}

	.zero-headline {
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--text-meta);
		margin: 0;
	}

	.zero-body {
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		margin: 0;
		max-width: 28ch;
		line-height: var(--leading-base);
	}

	/* --- Section list ---------------------------------------------------- */
	.section-list,
	.section-files,
	.result-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.section-item {
		margin-bottom: 2px;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 6px var(--space-3);
		border: none;
		background: transparent;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: var(--font-weight-medium);
		text-transform: uppercase;
		letter-spacing: var(--tracking-widest);
		text-align: left;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.section-header:hover {
		background-color: var(--surface-hover);
		color: var(--text-meta);
	}

	.section-header:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.section-chevron,
	.section-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.section-label {
		flex: 1;
	}

	.section-count {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		color: var(--text-muted);
		padding: 1px 6px;
		border-radius: var(--radius-full);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		font-variant-numeric: tabular-nums;
	}

	/* --- Section file collapse animation -------------------------------- */
	.section-files-wrap {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows var(--transition-base);
	}

	.section-files-wrap[data-open='true'] {
		grid-template-rows: 1fr;
	}

	.section-files-wrap > .section-files {
		overflow: hidden;
		min-height: 0;
		padding: 0 var(--space-2);
	}

	@media (prefers-reduced-motion: reduce) {
		.section-files-wrap {
			transition: none;
		}
	}

	/* --- File row -------------------------------------------------------- */
	.file-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		padding: 6px var(--space-3);
		margin: 1px 0;
		border: none;
		border-left: 2px solid transparent;
		background: transparent;
		color: var(--text-meta);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		text-align: left;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition:
			background-color var(--transition-micro),
			color var(--transition-micro),
			border-color var(--transition-micro);
		min-width: 0;
	}

	.file-row:hover {
		background-color: var(--surface-hover);
		color: var(--text-prose);
	}

	.file-row:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.file-row.active {
		background-color: var(--color-primary-subtle);
		color: var(--color-primary);
		border-left-color: var(--color-primary);
	}

	.file-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-meta {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.recency-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
	}

	.recency-dot.fresh {
		background-color: var(--color-success);
		box-shadow: 0 0 4px color-mix(in oklch, var(--color-success) 50%, transparent);
	}

	.recency-dot.recent {
		background-color: var(--color-primary);
	}

	.file-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		padding: 1px 4px;
		border-radius: var(--radius-xs);
		background-color: var(--surface-leaf);
		color: var(--text-muted);
		border: 1px solid var(--border-hairline);
		max-width: 8ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* --- Search results -------------------------------------------------- */
	.result-list {
		padding: 0 var(--space-2);
	}

	.result-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		margin: 2px 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast);
		min-width: 0;
	}

	.result-row:hover {
		background-color: var(--surface-hover);
		border-color: var(--border-hairline);
	}

	.result-row:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.result-row.active {
		background-color: var(--color-primary-subtle);
		border-color: var(--border-emphasis);
	}

	.result-title {
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		color: var(--text-prose);
		font-weight: var(--font-weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-path {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-widest);
	}

	.result-snippet {
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		color: var(--text-meta);
		line-height: var(--leading-snug);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
