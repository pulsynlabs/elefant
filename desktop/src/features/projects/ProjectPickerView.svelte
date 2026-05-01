<script lang="ts">
	// ProjectPickerView — the full-page editorial home shown when no project is active.
	//
	// Layout:
	//   - Hero: ambient animated gradient + display-serif title + primary CTA
	//   - Optional search bar (only when there are projects)
	//   - Featured strip (top 3 most-recent projects when projects.length >= 3)
	//   - Responsive grid of remaining ProjectCards
	//   - Loading skeleton, empty state, no-results state, error banner
	//
	// All motion is gated by `prefers-reduced-motion: no-preference`. No external
	// animation libraries — the orb drift and card stagger are pure CSS.

	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import type { Project } from '$lib/types/project.js';
	import { pickDirectory } from '$lib/tauri/dialog.js';
	import {
		HugeiconsIcon,
		FolderAddIcon,
		SearchIcon,
		CloseIcon,
	} from '$lib/icons/index.js';
	import ProjectCard from './ProjectCard.svelte';

	type Props = {
		onProjectSelected?: () => void;
	};

	let { onProjectSelected = () => {} }: Props = $props();

	// Kick off a load on mount if we haven't loaded yet. Using an $effect with
	// a guard keeps us idempotent across remounts (e.g. when the user clicks
	// back into the picker from the TopBar in later tasks).
	let hasTriggeredLoad = $state(false);

	$effect(() => {
		if (hasTriggeredLoad) return;
		hasTriggeredLoad = true;
		void projectsStore.loadProjects();
	});

	// --- Fuzzy search -----------------------------------------------------
	// A plain case-insensitive substring match over name + path keeps the
	// filter predictable and avoids pulling in a fuzzy library. Good enough
	// for the "I know what I'm looking for" use case this picker serves.
	let searchQuery = $state('');

	// --- Error dismissal --------------------------------------------------
	// The store's `lastError` is the source of truth; we track the most
	// recently-seen error so a user can dismiss the banner locally without
	// mutating store state. When a new error arrives the banner re-appears.
	let dismissedError = $state<string | null>(null);

	// --- Open-folder flow -------------------------------------------------
	// Tracks in-flight picker/open calls so rapid double-clicks can't stack.
	let isOpeningFolder = $state(false);

	async function handleOpenNewFolder(): Promise<void> {
		if (isOpeningFolder) return;
		isOpeningFolder = true;
		try {
			const dir = await pickDirectory();
			if (!dir) return; // User cancelled — no error, no navigation.
			await projectsStore.openProject(dir);
			onProjectSelected();
		} catch {
			// openProject already surfaces the message via projectsStore.lastError.
			// Swallow here so an unhandled rejection doesn't bubble to the console.
		} finally {
			isOpeningFolder = false;
		}
	}

	function dismissError(): void {
		dismissedError = projectsStore.lastError;
	}

	function handleSelect(project: Project): void {
		void projectsStore.selectProject(project.id);
		onProjectSelected();
	}

	function handleRename(project: Project, newName: string): void {
		console.info('[picker] renamed', project.id, '→', newName);
	}

	function handleDelete(project: Project): void {
		console.info('[picker] deleted', project.id);
	}

	// Derived convenience — avoids repeated access in the template.
	const projects = $derived(projectsStore.projects);
	const isLoading = $derived(projectsStore.isLoading);
	const lastError = $derived(projectsStore.lastError);

	const filteredProjects = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return projects;
		return projects.filter((p) => {
			const name = p.name.toLowerCase();
			const path = p.path.toLowerCase();
			return name.includes(query) || path.includes(query);
		});
	});

	const showError = $derived(
		lastError !== null && lastError !== dismissedError
	);
	const showSkeleton = $derived(isLoading && projects.length === 0);
	const showEmptyState = $derived(!isLoading && projects.length === 0);
	const showNoResults = $derived(
		!isLoading &&
			projects.length > 0 &&
			filteredProjects.length === 0 &&
			searchQuery.trim().length > 0
	);

	// --- Featured strip ---------------------------------------------------
	// Show a featured strip of the top 3 projects only when:
	//   - We have at least 3 projects total, AND
	//   - The user isn't actively filtering (so the strip doesn't churn as
	//     they type and the layout stays predictable while searching).
	const featuredCount = $derived(
		!searchQuery.trim() && filteredProjects.length >= 3 ? 3 : 0
	);
	const featuredProjects = $derived(filteredProjects.slice(0, featuredCount));
	const remainingProjects = $derived(filteredProjects.slice(featuredCount));
</script>

<section class="picker" aria-labelledby="picker-title">
	<div class="hero">
		<div class="hero-orb hero-orb-a" aria-hidden="true"></div>
		<div class="hero-orb hero-orb-b" aria-hidden="true"></div>

		<div class="hero-inner">
			<header class="picker-header">
				<div class="picker-heading">
					<p class="picker-eyebrow">Workspace</p>
					<h1 id="picker-title" class="picker-title">Your projects</h1>
					<p class="picker-subtitle">
						Pick up where you left off.
					</p>
				</div>

				<button
					type="button"
					class="primary-button"
					onclick={handleOpenNewFolder}
					disabled={isOpeningFolder}
					aria-busy={isOpeningFolder}
				>
					<span class="primary-button-icon" aria-hidden="true">
						<HugeiconsIcon icon={FolderAddIcon} size={16} strokeWidth={1.8} />
					</span>
					{isOpeningFolder ? 'Opening…' : 'Open New Folder'}
				</button>
			</header>
		</div>
	</div>

	<div class="picker-inner">
		{#if showError && lastError}
			<div class="error-banner" role="alert">
				<span class="error-label">Error</span>
				<span class="error-message">{lastError}</span>
				<button
					type="button"
					class="error-dismiss"
					aria-label="Dismiss error"
					onclick={dismissError}
				>
					<HugeiconsIcon icon={CloseIcon} size={14} strokeWidth={2} />
				</button>
			</div>
		{/if}

		{#if projects.length > 0}
			<div class="search">
				<span class="search-icon" aria-hidden="true">
					<HugeiconsIcon icon={SearchIcon} size={16} strokeWidth={1.8} />
				</span>
				<input
					type="search"
					class="search-input"
					placeholder="Search projects by name or path"
					aria-label="Search projects"
					bind:value={searchQuery}
					autocomplete="off"
					spellcheck="false"
				/>
				{#if searchQuery.length > 0}
					<button
						type="button"
						class="search-clear"
						aria-label="Clear search"
						onclick={() => (searchQuery = '')}
					>
						<HugeiconsIcon icon={CloseIcon} size={14} strokeWidth={2} />
					</button>
				{/if}
			</div>
		{/if}

		{#if showSkeleton}
			<div class="grid" aria-busy="true" aria-label="Loading projects">
				{#each Array.from({ length: 4 }) as _, i (i)}
					<div class="skeleton-card" aria-hidden="true">
						<div class="skeleton-avatar"></div>
						<div class="skeleton-lines">
							<div class="skeleton-line skeleton-line-title"></div>
							<div class="skeleton-line skeleton-line-path"></div>
							<div class="skeleton-line skeleton-line-meta"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if showEmptyState}
			<div class="empty" role="status">
				<div class="empty-illustration" aria-hidden="true">
					<HugeiconsIcon icon={FolderAddIcon} size={32} strokeWidth={1.2} />
				</div>
				<h2 class="empty-title">No projects yet</h2>
				<p class="empty-description">
					Open a folder to get started. Elefant will create a
					<code class="empty-code">.elefant/</code>
					directory inside it to keep your sessions and memory.
				</p>
				<button
					type="button"
					class="primary-button empty-cta"
					onclick={handleOpenNewFolder}
				>
					<span class="primary-button-icon" aria-hidden="true">
						<HugeiconsIcon icon={FolderAddIcon} size={16} strokeWidth={1.8} />
					</span>
					Open a folder
				</button>
			</div>
		{:else if showNoResults}
			<div class="no-results" role="status">
				<p class="no-results-title">No projects match “{searchQuery}”</p>
				<p class="no-results-description">
					Try a different term, or clear the search to see all projects.
				</p>
				<button
					type="button"
					class="secondary-button"
					onclick={() => (searchQuery = '')}
				>
					Clear search
				</button>
			</div>
		{:else}
			{#if featuredCount > 0}
				<div class="section-label" aria-hidden="true">Recent</div>
				<div
					class="featured-grid"
					role="list"
					aria-label="Featured projects"
				>
					{#each featuredProjects as project, i (project.id)}
						<div
							role="listitem"
							class="grid-item featured"
							style="--card-index: {i}"
						>
							<ProjectCard
								{project}
								featured
								onSelect={handleSelect}
								onRename={handleRename}
								onDelete={handleDelete}
							/>
						</div>
					{/each}
				</div>
			{/if}

			{#if remainingProjects.length > 0}
				{#if featuredCount > 0}
					<div class="section-label" aria-hidden="true">All projects</div>
				{/if}
				<div
					class="grid"
					role="list"
					aria-label={featuredCount > 0
						? 'All projects'
						: 'Recent projects'}
				>
					{#each remainingProjects as project, i (project.id)}
						<div
							role="listitem"
							class="grid-item"
							style="--card-index: {featuredCount + i}"
						>
							<ProjectCard
								{project}
								onSelect={handleSelect}
								onRename={handleRename}
								onDelete={handleDelete}
							/>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</section>

<style>
	.picker {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		overflow-x: hidden;
	}

	/* --- Hero ----------------------------------------------------------- */
	.hero {
		position: relative;
		width: 100%;
		display: flex;
		justify-content: center;
		/* overflow: hidden removed — orbs must bleed past the hero boundary
		   so the indigo glow fades continuously into picker-inner below.
		   isolation: isolate removed for the same reason: a new stacking
		   context would clip the fixed AppShell gradient. */
	}

	.hero-inner {
		width: 100%;
		max-width: 960px;
		padding: var(--space-10) var(--space-7) var(--space-8);
		position: relative;
		z-index: 1;
	}

	/* Two ambient orbs that quietly drift behind the hero. They're decorative
	   and use color-mix for a tinted indigo bloom that sits naturally on the
	   substrate without clashing with content. */
	/* Orbs are position:absolute within .hero but overflow freely because
	   .hero no longer clips. Large blur radii ensure the indigo bleeds
	   well past the hero bottom edge into the project grid below. */
	.hero-orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(100px);
		pointer-events: none;
		z-index: 0;
		opacity: 0.7;
	}

	.hero-orb-a {
		width: 900px;
		height: 900px;
		left: -280px;
		top: -300px;
		background: radial-gradient(
			circle at 50% 50%,
			color-mix(in oklch, var(--color-primary) 18%, transparent) 0%,
			color-mix(in oklch, var(--color-primary) 7%, transparent) 45%,
			transparent 78%
		);
	}

	.hero-orb-b {
		width: 700px;
		height: 700px;
		right: -200px;
		top: -150px;
		background: radial-gradient(
			circle at 50% 50%,
			color-mix(in oklch, var(--color-primary) 22%, transparent) 0%,
			color-mix(in oklch, var(--color-primary) 9%, transparent) 45%,
			transparent 72%
		);
	}

	@media (prefers-reduced-motion: no-preference) {
		.hero-orb-a {
			animation: orb-drift-a 40s ease-in-out infinite;
		}

		.hero-orb-b {
			animation: orb-drift-b 30s ease-in-out infinite;
		}
	}

	@keyframes orb-drift-a {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(30px, -20px);
		}
	}

	@keyframes orb-drift-b {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(-20px, 30px);
		}
	}

	.picker-inner {
		width: 100%;
		max-width: 960px;
		padding: 0 var(--space-7) var(--space-9);
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}

	.picker-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-5);
		flex-wrap: wrap;
	}

	.picker-heading {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.picker-eyebrow {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
		margin: 0;
	}

	.picker-title {
		font-family: var(--font-display);
		font-style: italic;
		font-weight: 400;
		font-size: clamp(32px, 4vw, 52px);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-tight);
		line-height: var(--line-height-tight);
		margin: 0;
	}

	.picker-subtitle {
		font-family: var(--font-body);
		font-size: var(--font-size-base);
		color: var(--color-text-secondary);
		line-height: var(--line-height-relaxed);
		margin: 0;
		max-width: 52ch;
	}

	/* --- Primary button --------------------------------------------------
	   Local button styles so we don't need to thread the shadcn Button
	   component here (and to stay consistent with other feature views). */
	.primary-button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-md);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-snug);
		cursor: pointer;
		box-shadow: 0 0 16px rgba(64, 73, 225, 0.25);
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
		white-space: nowrap;
	}

	.primary-button:hover {
		background-color: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		box-shadow: 0 0 24px rgba(64, 73, 225, 0.4);
	}

	.primary-button:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.primary-button:active {
		transform: translateY(1px);
	}

	.primary-button:disabled {
		cursor: progress;
		opacity: 0.7;
		box-shadow: none;
	}

	.primary-button:disabled:hover {
		background-color: var(--color-primary);
		border-color: var(--color-primary);
		box-shadow: none;
	}

	.primary-button-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	/* --- Secondary button ----------------------------------------------- */
	.secondary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background-color: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.secondary-button:hover {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
	}

	.secondary-button:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	/* --- Error banner --------------------------------------------------- */
	.error-banner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-md);
		background-color: color-mix(in srgb, var(--color-error) 10%, transparent);
		color: var(--color-text-primary);
	}

	.error-label {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-widest);
		color: var(--color-error);
		flex-shrink: 0;
	}

	.error-message {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.error-dismiss {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background-color: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.error-dismiss:hover {
		background-color: color-mix(in srgb, var(--color-error) 15%, transparent);
		color: var(--color-text-primary);
	}

	.error-dismiss:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	/* --- Search --------------------------------------------------------- */
	.search {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	.search-icon {
		position: absolute;
		left: var(--space-4);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: var(--space-3) var(--space-4) var(--space-3) calc(var(--space-4) + 24px);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background-color: var(--color-surface);
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		line-height: var(--line-height-normal);
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			background-color var(--transition-fast);
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
	}

	.search-input:hover {
		border-color: var(--color-border-strong);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--color-primary);
		background-color: var(--color-surface-elevated);
		box-shadow: var(--glow-focus);
	}

	/* Remove the default "X" clear button in WebKit so our own button is
	   the single, styled affordance. */
	.search-input::-webkit-search-cancel-button {
		appearance: none;
	}

	.search-clear {
		position: absolute;
		right: var(--space-3);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background-color: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.search-clear:hover {
		background-color: var(--color-surface-hover);
		color: var(--color-text-primary);
	}

	.search-clear:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	/* --- No-results state ----------------------------------------------- */
	.no-results {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-3);
		padding: var(--space-8) var(--space-6);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		background-color: var(--color-surface);
	}

	.no-results-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		margin: 0;
	}

	.no-results-description {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: 0;
		max-width: 44ch;
	}

	/* --- Section label -------------------------------------------------- */
	.section-label {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
		margin-top: calc(-1 * var(--space-3));
		margin-bottom: calc(-1 * var(--space-3));
	}

	/* --- Featured strip ------------------------------------------------- */
	.featured-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-4);
	}

	@media (max-width: 880px) {
		.featured-grid {
			grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		}
	}

	/* --- Grid ----------------------------------------------------------- */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-4);
	}

	.grid-item {
		min-width: 0;
	}

	/* Staggered card entry — gated by reduced-motion. We use `both` so the
	   "from" frame applies pre-animation and avoids a flash of unstyled
	   content when the cards mount. */
	@media (prefers-reduced-motion: no-preference) {
		.grid-item {
			animation: card-enter 0.35s var(--ease-out-expo) both;
			animation-delay: calc(var(--card-index, 0) * 50ms);
		}
	}

	@keyframes card-enter {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* --- Skeleton ------------------------------------------------------- */
	.skeleton-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.skeleton-avatar {
		width: 44px;
		height: 44px;
		border-radius: var(--radius-lg);
		background-color: var(--color-surface-hover);
		animation: pulse 1.6s ease-in-out infinite;
		flex-shrink: 0;
	}

	.skeleton-lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 1;
		padding-top: var(--space-1);
	}

	.skeleton-line {
		height: 10px;
		border-radius: var(--radius-sm);
		background-color: var(--color-surface-hover);
		animation: pulse 1.6s ease-in-out infinite;
	}

	.skeleton-line-title { width: 60%; height: 12px; }
	.skeleton-line-path  { width: 85%; }
	.skeleton-line-meta  { width: 35%; height: 8px; }

	@keyframes pulse {
		0%, 100% { opacity: 0.6; }
		50%      { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-avatar,
		.skeleton-line {
			animation: none;
		}
	}

	/* --- Empty state ---------------------------------------------------- */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-3);
		padding: var(--space-10) var(--space-6);
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-xl);
		background-color: var(--color-surface);
	}

	.empty-illustration {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		border-radius: var(--radius-xl);
		background-color: var(--color-primary-subtle);
		color: var(--color-primary);
		margin-bottom: var(--space-2);
		box-shadow: var(--glow-ambient);
	}

	.empty-title {
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		margin: 0;
	}

	.empty-description {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		line-height: var(--line-height-relaxed);
		margin: 0;
		max-width: 46ch;
	}

	.empty-code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background-color: var(--color-surface-elevated);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.empty-cta {
		margin-top: var(--space-4);
	}

	/* --- Responsive tweaks ---------------------------------------------- */
	@media (max-width: 640px) {
		.hero-inner {
			padding: var(--space-8) var(--space-4) var(--space-7);
		}

		.picker-inner {
			padding: 0 var(--space-4) var(--space-7);
			gap: var(--space-6);
		}

		.picker-header {
			flex-direction: column;
			align-items: stretch;
		}

		.primary-button {
			justify-content: center;
		}
	}
</style>
