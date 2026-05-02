<script lang="ts">
	// RemoteFileBrowser — modal directory browser for remote daemons.
	//
	// When the active server is remote (or when running in a plain browser
	// where the Tauri runtime is unavailable), users open a project by
	// browsing the daemon's filesystem through this modal. It calls the
	// daemon's `GET /api/fs/list` endpoint via the fs-service client.
	//
	// Behaviour:
	//   - On open: loads the daemon's home directory (no path arg).
	//   - Click a directory row → navigate into it.
	//   - Breadcrumb segments → navigate to that ancestor.
	//   - "Select this folder" → returns the current path via onSelect.
	//   - ESC or backdrop click → onCancel.
	//   - Files are filtered out — only directories are shown.

	import { onDestroy } from 'svelte';
	import {
		listRemoteDirectory,
		type FsEntry,
		type FsListResult,
	} from '$lib/services/fs-service.js';
	import {
		HugeiconsIcon,
		FolderIcon,
		CloseIcon,
		ChevronRightIcon,
	} from '$lib/icons/index.js';

	// ---------------------------------------------------------------------
	// Props
	// ---------------------------------------------------------------------

	type Props = {
		open: boolean;
		onSelect: (path: string) => void;
		onCancel: () => void;
		title?: string;
	};

	let { open, onSelect, onCancel, title = 'Open Project' }: Props = $props();

	// ---------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------

	type LoadState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; data: FsListResult }
		| { kind: 'error'; error: string };

	let state = $state<LoadState>({ kind: 'idle' });

	// Track the latest in-flight request so stale results don't overwrite a
	// newer navigation. Each navigation increments this token; only results
	// matching the current token are committed to state.
	let requestToken = 0;

	// ---------------------------------------------------------------------
	// Lifecycle — load home directory when the modal opens
	// ---------------------------------------------------------------------

	$effect(() => {
		if (!open) {
			// Reset when closed so the next open starts fresh at home.
			state = { kind: 'idle' };
			return;
		}

		// Only kick off an initial load if we haven't started one yet.
		if (state.kind === 'idle') {
			void load(undefined);
		}
	});

	onDestroy(() => {
		// Bump the token so any in-flight result is discarded.
		requestToken += 1;
	});

	// ---------------------------------------------------------------------
	// Loaders
	// ---------------------------------------------------------------------

	async function load(path: string | undefined): Promise<void> {
		const myToken = ++requestToken;
		state = { kind: 'loading' };

		const result = await listRemoteDirectory(path);

		// Discard results from superseded requests.
		if (myToken !== requestToken) return;

		if (result.ok) {
			state = { kind: 'ok', data: result.data };
		} else {
			state = { kind: 'error', error: result.error };
		}
	}

	function retry(): void {
		// Re-issue the most recent navigation. If we don't know where the
		// user was, fall back to home (undefined).
		const path =
			state.kind === 'ok' ? state.data.path : undefined;
		void load(path);
	}

	// ---------------------------------------------------------------------
	// Navigation
	// ---------------------------------------------------------------------

	function navigateTo(path: string): void {
		void load(path);
	}

	function enterDirectory(entry: FsEntry): void {
		if (state.kind !== 'ok') return;
		const currentPath = state.data.path;
		// Normalise: avoid double-slash when current path is "/".
		const next =
			currentPath === '/'
				? `/${entry.name}`
				: `${currentPath}/${entry.name}`;
		void load(next);
	}

	function selectCurrent(): void {
		if (state.kind !== 'ok') return;
		onSelect(state.data.path);
	}

	// ---------------------------------------------------------------------
	// Derived
	// ---------------------------------------------------------------------

	/** Breadcrumb segments for the current path. Always begins with root. */
	type Crumb = { label: string; path: string };

	const crumbs = $derived.by<Crumb[]>(() => {
		if (state.kind !== 'ok') return [];
		const path = state.data.path;
		// Always emit a root crumb first.
		const root: Crumb = { label: '/', path: '/' };
		if (path === '/' || path === '') return [root];

		const parts = path.split('/').filter(Boolean);
		const out: Crumb[] = [root];
		let acc = '';
		for (const part of parts) {
			acc += `/${part}`;
			out.push({ label: part, path: acc });
		}
		return out;
	});

	/** Directories only, sorted alphabetically (case-insensitive). */
	const directories = $derived.by<FsEntry[]>(() => {
		if (state.kind !== 'ok') return [];
		return state.data.entries
			.filter((e) => e.isDir)
			.slice()
			.sort((a, b) =>
				a.name.localeCompare(b.name, undefined, {
					sensitivity: 'base',
				}),
			);
	});

	const isEmpty = $derived(
		state.kind === 'ok' && directories.length === 0,
	);

	// ---------------------------------------------------------------------
	// Keyboard + backdrop dismissal
	// ---------------------------------------------------------------------

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			onCancel();
		}
	}

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			onCancel();
		}
	}

	function handleBackdropKey(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onCancel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={handleBackdropClick}
		onkeydown={handleBackdropKey}
	>
		<div
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="remote-file-browser-title"
		>
			<header class="modal-header">
				<h2 id="remote-file-browser-title" class="modal-title">
					{title}
				</h2>
				<button
					class="close-button"
					type="button"
					onclick={onCancel}
					aria-label="Close"
				>
					<HugeiconsIcon icon={CloseIcon} size={16} strokeWidth={1.8} />
				</button>
			</header>

			<nav class="breadcrumb" aria-label="Current path">
				{#if state.kind === 'ok'}
					{#each crumbs as crumb, i (crumb.path)}
						{#if i > 0}
							<span class="breadcrumb-sep" aria-hidden="true">
								<HugeiconsIcon
									icon={ChevronRightIcon}
									size={12}
									strokeWidth={2}
								/>
							</span>
						{/if}
						<button
							type="button"
							class="breadcrumb-segment"
							class:active={i === crumbs.length - 1}
							disabled={i === crumbs.length - 1}
							onclick={() => navigateTo(crumb.path)}
						>
							{crumb.label}
						</button>
					{/each}
				{:else}
					<span class="breadcrumb-segment placeholder">/</span>
				{/if}
			</nav>

			<div class="modal-body" role="region" aria-label="Directory contents">
				{#if state.kind === 'loading'}
					<ul class="dir-list" aria-busy="true" aria-label="Loading">
						{#each Array.from({ length: 4 }) as _, i (i)}
							<li class="skeleton-row" aria-hidden="true">
								<span class="skeleton-icon"></span>
								<span class="skeleton-line"></span>
							</li>
						{/each}
					</ul>
				{:else if state.kind === 'error'}
					<div class="error-state" role="alert">
						<p class="error-title">Unable to load directory</p>
						<p class="error-message">{state.error}</p>
						<button
							class="btn btn-secondary"
							type="button"
							onclick={retry}
						>
							Retry
						</button>
					</div>
				{:else if state.kind === 'ok'}
					{#if isEmpty}
						<div class="empty-state" role="status">
							<p class="empty-title">This folder is empty</p>
							<p class="empty-hint">
								You can still select it as your project root.
							</p>
						</div>
					{:else}
						<ul class="dir-list" aria-label="Directories">
							{#each directories as entry (entry.name)}
								<li>
									<button
										type="button"
										class="dir-row"
										onclick={() => enterDirectory(entry)}
										ondblclick={() => enterDirectory(entry)}
									>
										<span class="dir-icon" aria-hidden="true">
											<HugeiconsIcon
												icon={FolderIcon}
												size={18}
												strokeWidth={1.6}
											/>
										</span>
										<span class="dir-name">{entry.name}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>

			<footer class="modal-footer">
				<button
					class="btn btn-primary"
					type="button"
					onclick={selectCurrent}
					disabled={state.kind !== 'ok'}
				>
					Select this folder
				</button>
				<button
					class="btn btn-secondary"
					type="button"
					onclick={onCancel}
				>
					Cancel
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background-color: rgba(0, 0, 0, 0.5);
		animation: fade-in var(--transition-base);
	}

	.modal {
		width: 560px;
		max-width: calc(100vw - 32px);
		height: 480px;
		max-height: calc(100vh - 64px);
		display: flex;
		flex-direction: column;
		background-color: var(--surface-plate);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xl);
		overflow: hidden;
		animation: slide-up var(--duration-base) var(--ease-out-expo);
	}

	/* ─── Header ──────────────────────────────────────────────────────── */
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--border-hairline);
		flex-shrink: 0;
	}

	.modal-title {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: 600;
		color: var(--text-prose);
	}

	.close-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background-color: transparent;
		color: var(--text-meta);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base),
			border-color var(--transition-base);
	}

	.close-button:hover,
	.close-button:focus-visible {
		background-color: var(--surface-hover);
		color: var(--text-prose);
		outline: none;
	}

	.close-button:focus-visible {
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus);
	}

	/* ─── Breadcrumb ──────────────────────────────────────────────────── */
	.breadcrumb {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-4);
		background-color: var(--surface-leaf);
		border-bottom: 1px solid var(--border-hairline);
		font-size: 12px;
		color: var(--text-muted);
		flex-shrink: 0;
		min-height: 36px;
	}

	.breadcrumb-segment {
		display: inline-flex;
		align-items: center;
		padding: var(--space-1) var(--space-2);
		background-color: transparent;
		color: var(--text-muted);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base);
	}

	.breadcrumb-segment:hover:not(:disabled),
	.breadcrumb-segment:focus-visible:not(:disabled) {
		background-color: var(--surface-hover);
		color: var(--text-prose);
		outline: none;
	}

	.breadcrumb-segment:focus-visible {
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus);
	}

	.breadcrumb-segment.active,
	.breadcrumb-segment:disabled {
		color: var(--text-prose);
		cursor: default;
	}

	.breadcrumb-segment.placeholder {
		color: var(--text-muted);
		cursor: default;
		padding: var(--space-1) var(--space-2);
	}

	.breadcrumb-sep {
		display: inline-flex;
		align-items: center;
		color: var(--text-disabled);
		flex-shrink: 0;
	}

	/* ─── Body ─────────────────────────────────────────────────────────── */
	.modal-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2) 0;
	}

	.dir-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.dir-list li {
		margin: 0;
	}

	.dir-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3) var(--space-4);
		background-color: transparent;
		color: var(--text-prose);
		border: 1px solid transparent;
		border-left-width: 0;
		border-right-width: 0;
		border-radius: 0;
		text-align: left;
		cursor: pointer;
		min-height: 44px;
		transition: background-color var(--transition-base);
	}

	.dir-row:hover,
	.dir-row:focus-visible {
		background-color: var(--surface-hover);
		outline: none;
	}

	.dir-row:focus-visible {
		border-top-color: var(--border-focus);
		border-bottom-color: var(--border-focus);
		box-shadow: var(--glow-focus);
	}

	.dir-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
		flex-shrink: 0;
	}

	.dir-name {
		font-size: 14px;
		color: var(--text-prose);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1;
	}

	/* ─── Skeleton ─────────────────────────────────────────────────────── */
	.skeleton-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		min-height: 44px;
	}

	.skeleton-icon {
		display: inline-block;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-sm);
		background-color: var(--surface-hover);
		animation: pulse 1.6s ease-in-out infinite;
		flex-shrink: 0;
	}

	.skeleton-line {
		display: inline-block;
		height: 12px;
		flex: 1;
		max-width: 60%;
		border-radius: var(--radius-sm);
		background-color: var(--surface-hover);
		animation: pulse 1.6s ease-in-out infinite;
	}

	/* ─── Error state ──────────────────────────────────────────────────── */
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-8) var(--space-5);
		text-align: center;
		height: 100%;
	}

	.error-title {
		margin: 0;
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-prose);
	}

	.error-message {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-error);
		max-width: 44ch;
		overflow-wrap: anywhere;
	}

	/* ─── Empty state ──────────────────────────────────────────────────── */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-8) var(--space-5);
		text-align: center;
		height: 100%;
	}

	.empty-title {
		margin: 0;
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-prose);
	}

	.empty-hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	/* ─── Footer ───────────────────────────────────────────────────────── */
	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-4);
		border-top: 1px solid var(--border-hairline);
		background-color: var(--surface-substrate);
		flex-shrink: 0;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 36px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base),
			border-color var(--transition-base),
			opacity var(--transition-base);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		background-color: transparent;
		color: var(--text-meta);
		border: 1px solid var(--border-edge);
	}

	.btn-secondary:hover:not(:disabled),
	.btn-secondary:focus-visible:not(:disabled) {
		background-color: var(--surface-hover);
		color: var(--text-prose);
		outline: none;
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: 1px solid var(--color-primary);
	}

	.btn-primary:hover:not(:disabled),
	.btn-primary:focus-visible:not(:disabled) {
		background-color: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		outline: none;
	}

	/* ─── Animations ───────────────────────────────────────────────────── */
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slide-up {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 1;
		}
	}

	/* ─── Mobile (≤640px) — full-screen modal ──────────────────────────── */
	@media (max-width: 640px) {
		.modal-backdrop {
			padding: 0;
		}

		.modal {
			width: 100%;
			max-width: 100%;
			height: 100vh;
			max-height: 100vh;
			border-radius: 0;
			border-left: none;
			border-right: none;
		}

		.close-button {
			width: 44px;
			height: 44px;
		}

		.dir-row {
			min-height: 48px;
		}

		.btn {
			min-height: 44px;
		}
	}

	/* ─── Reduced motion ───────────────────────────────────────────────── */
	@media (prefers-reduced-motion: reduce) {
		.modal,
		.modal-backdrop {
			animation: none;
		}

		.skeleton-icon,
		.skeleton-line {
			animation: none;
		}
	}
</style>
