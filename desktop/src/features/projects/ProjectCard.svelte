<script lang="ts">
	// ProjectCard — a single project tile in the Project Picker grid.
	//
	// - Body click / Enter / Space emits `onSelect`
	// - Hover (or keyboard focus) reveals rename + delete icon buttons
	// - Rename: click the edit icon -> converts name to an input -> Enter/blur commits,
	//   Esc cancels. The input auto-focuses and selects its text when it
	//   appears so the user can immediately retype.
	// - Delete: click the delete icon -> opens DeleteProjectDialog -> confirm calls the
	//   store's deleteProject. Cancel closes the dialog without side effects.
	//
	// Rename and delete call the projects store directly because the input
	// UX owns its lifecycle (auto-focus, commit-on-blur). The optional
	// `onRename` / `onDelete` callbacks still fire after a successful
	// mutation so parents can observe if they need to (e.g. logging).

	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import type { Project } from '$lib/types/project.js';
	import {
		HugeiconsIcon,
		EditIcon,
		DeleteIcon,
	} from '$lib/icons/index.js';
	import ProjectAvatar from './ProjectAvatar.svelte';
	import DeleteProjectDialog from './DeleteProjectDialog.svelte';

	type Props = {
		project: Project;
		onSelect?: (project: Project) => void;
		onRename?: (project: Project, newName: string) => void;
		onDelete?: (project: Project) => void;
	};

	let { project, onSelect, onRename, onDelete }: Props = $props();

	// --- Inline rename state ----------------------------------------------
	let isRenaming = $state(false);
	let renameValue = $state('');
	let renameInputEl = $state<HTMLInputElement | null>(null);
	// Guards so "blur" doesn't fire a second commit when Enter/Esc already
	// triggered one. Svelte would otherwise fire keydown → state change →
	// input unmount → blur, and we'd race with ourselves.
	let isCommitting = $state(false);

	// --- Delete confirmation state ----------------------------------------
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);

	// Auto-focus (and select) the rename input the moment it appears.
	// Using $effect + bind:this is the established pattern in this codebase.
	$effect(() => {
		if (isRenaming && renameInputEl) {
			renameInputEl.focus();
			renameInputEl.select();
		}
	});

	// --- Relative time formatting -----------------------------------------
	// Lightweight "N units ago" formatter backed by Intl.RelativeTimeFormat.
	// No new dependency, respects the user's locale.
	const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
		numeric: 'auto',
	});

	const UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
		{ unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
		{ unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
		{ unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
		{ unit: 'day', ms: 24 * 60 * 60 * 1000 },
		{ unit: 'hour', ms: 60 * 60 * 1000 },
		{ unit: 'minute', ms: 60 * 1000 },
		{ unit: 'second', ms: 1000 },
	];

	function formatRelative(iso: string): string {
		const then = new Date(iso).getTime();
		if (Number.isNaN(then)) return '';
		const deltaMs = then - Date.now();
		const abs = Math.abs(deltaMs);
		for (const { unit, ms } of UNITS) {
			if (abs >= ms || unit === 'second') {
				const value = Math.round(deltaMs / ms);
				return relativeFormatter.format(value, unit);
			}
		}
		return '';
	}

	const relativeTime = $derived(formatRelative(project.updatedAt));

	// Truncate the path in the middle so the head (root) and tail (folder)
	// both stay visible, which matches how most OS file pickers render.
	function truncatePath(path: string, max = 48): string {
		if (path.length <= max) return path;
		const keep = Math.floor((max - 1) / 2);
		return `${path.slice(0, keep)}…${path.slice(path.length - keep)}`;
	}

	const displayPath = $derived(truncatePath(project.path));

	// --- Event handlers ---------------------------------------------------
	function handleSelect(): void {
		// Don't navigate away from the card while an action is active.
		if (isRenaming || showDeleteConfirm) return;
		onSelect?.(project);
	}

	function handleCardKeydown(event: KeyboardEvent): void {
		if (isRenaming || showDeleteConfirm) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSelect();
		}
	}

	function startRename(event: MouseEvent): void {
		event.stopPropagation();
		renameValue = project.name;
		isRenaming = true;
	}

	async function commitRename(): Promise<void> {
		if (isCommitting) return;
		isCommitting = true;

		const next = renameValue.trim();
		const current = project.name;

		// Leave rename mode before the async call so the input unmounts and
		// any pending blur/keydown events don't re-enter this handler.
		isRenaming = false;

		if (next.length === 0 || next === current) {
			// Empty or unchanged — treat as a cancel. No store call.
			isCommitting = false;
			return;
		}

		try {
			await projectsStore.renameProject(project.id, next);
			onRename?.(project, next);
		} finally {
			isCommitting = false;
		}
	}

	function cancelRename(): void {
		if (isCommitting) return;
		isRenaming = false;
		renameValue = '';
	}

	function handleRenameKeydown(event: KeyboardEvent): void {
		// Stop propagation so the card's own Enter/Space handler doesn't
		// also try to "select" the project while the user is typing.
		event.stopPropagation();

		if (event.key === 'Enter') {
			event.preventDefault();
			void commitRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelRename();
		}
	}

	function handleRenameBlur(): void {
		// Blur = same as Enter: commit if non-empty, otherwise cancel.
		// commitRename() internally guards against double-firing when the
		// user pressed Enter (which already flipped isRenaming=false).
		if (!isRenaming) return;
		void commitRename();
	}

	function handleRenameClick(event: MouseEvent): void {
		// Don't let clicks inside the input bubble up to the card body.
		event.stopPropagation();
	}

	function requestDelete(event: MouseEvent): void {
		event.stopPropagation();
		showDeleteConfirm = true;
	}

	function cancelDelete(): void {
		if (isDeleting) return;
		showDeleteConfirm = false;
	}

	async function confirmDelete(): Promise<void> {
		if (isDeleting) return;
		isDeleting = true;
		try {
			await projectsStore.deleteProject(project.id);
			onDelete?.(project);
			// The card itself is typically unmounted by the parent after
			// the store updates, but clear the flag defensively.
			showDeleteConfirm = false;
		} finally {
			isDeleting = false;
		}
	}
</script>

<div
	class="card"
	class:card-active={isRenaming || showDeleteConfirm}
	role="button"
	tabindex="0"
	aria-label="Open project {project.name}"
	onclick={handleSelect}
	onkeydown={handleCardKeydown}
>
	<div class="card-body">
		<ProjectAvatar projectId={project.id} name={project.name} size={44} />

		<div class="card-text">
			{#if isRenaming}
				<input
					type="text"
					class="card-title-input"
					bind:value={renameValue}
					bind:this={renameInputEl}
					onkeydown={handleRenameKeydown}
					onblur={handleRenameBlur}
					onclick={handleRenameClick}
					aria-label="Rename project"
					maxlength="120"
					autocomplete="off"
					spellcheck="false"
				/>
			{:else}
				<h3 class="card-title" title={project.name}>{project.name}</h3>
			{/if}
			<p class="card-path" title={project.path}>{displayPath}</p>
			{#if relativeTime}
				<p class="card-meta">
					<span class="meta-label">Opened</span>
					<span class="meta-value">{relativeTime}</span>
				</p>
			{/if}
		</div>
	</div>

	{#if !isRenaming}
		<div class="card-actions" aria-label="Project actions">
			<button
				type="button"
				class="icon-button"
				aria-label="Rename {project.name}"
				onclick={startRename}
			>
				<HugeiconsIcon icon={EditIcon} size={16} strokeWidth={1.5} />
			</button>
			<button
				type="button"
				class="icon-button icon-button-danger"
				aria-label="Delete {project.name}"
				onclick={requestDelete}
			>
				<HugeiconsIcon icon={DeleteIcon} size={16} strokeWidth={1.5} />
			</button>
		</div>
	{/if}
</div>

{#if showDeleteConfirm}
	<DeleteProjectDialog
		{project}
		{isDeleting}
		onCancel={cancelDelete}
		onConfirm={confirmDelete}
	/>
{/if}

<style>
	.card {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		cursor: pointer;
		text-align: left;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.card:hover {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
		box-shadow: var(--shadow-md);
	}

	.card:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.card:active {
		transform: translateY(1px);
	}

	/* While renaming or confirming, suppress the "click-to-open" cue. */
	.card-active {
		cursor: default;
	}

	.card-active:active {
		transform: none;
	}

	.card-body {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		flex: 1;
		min-width: 0; /* allow text truncation */
	}

	.card-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}

	.card-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		line-height: var(--line-height-snug);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin: 0;
	}

	.card-title-input {
		width: 100%;
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		line-height: var(--line-height-snug);
		padding: 2px var(--space-2);
		margin: -3px calc(-1 * var(--space-2)) 0;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		background-color: var(--color-surface-elevated);
		box-shadow: var(--glow-focus);
		outline: none;
	}

	.card-title-input:focus {
		outline: none;
	}

	.card-path {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: var(--line-height-snug);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin: 0;
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-2xs);
		color: var(--color-text-muted);
		margin-top: var(--space-1);
		margin-bottom: 0;
	}

	.meta-label {
		text-transform: uppercase;
		letter-spacing: var(--tracking-widest);
		color: var(--color-text-disabled);
	}

	.meta-value {
		color: var(--color-text-secondary);
	}

	/* --- Actions row (rename / delete) ---------------------------------- */
	.card-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		opacity: 0;
		transform: translateX(4px);
		transition:
			opacity var(--transition-fast),
			transform var(--transition-fast);
		flex-shrink: 0;
	}

	/* Reveal on hover OR when any descendant is focused (keyboard). */
	.card:hover .card-actions,
	.card:focus-within .card-actions {
		opacity: 1;
		transform: translateX(0);
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background-color: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.icon-button:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-elevated);
		border-color: var(--color-border);
	}

	.icon-button:focus-visible {
		outline: none;
		color: var(--color-text-primary);
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
		/* Keep actions visible if the user tabs straight to one. */
		opacity: 1;
	}

	.icon-button-danger:hover {
		color: var(--color-error);
		border-color: var(--color-error);
	}

	/* When actions are hidden, make sure they're also not tab-reachable
	   in a visually confusing way — but we keep them focusable because
	   :focus-within reveals them (see rule above). That's the intended UX:
	   Tab reaches them, which reveals them. No extra work needed. */
</style>
