<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		HugeiconsIcon,
		EditIcon,
		PlusIcon,
		DeleteIcon,
		ViewIcon,
		CloseIcon,
	} from '$lib/icons/index.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import {
		fileChangesStore,
		type FileChange,
		type FileChangeType,
	} from '$lib/stores/file-changes.svelte.js';
	import DiffViewer from '$lib/components/DiffViewer.svelte';

	// ── Subscription wiring ────────────────────────────────────────────────
	//
	// The store owns its own SSE/EventSource lifecycle. This component
	// acts as the activation surface: it forwards the active project +
	// session id whenever they change. The store filters duplicates so
	// repeated activations are free.
	$effect(() => {
		fileChangesStore.setActiveSession(
			projectsStore.activeProjectId,
			projectsStore.activeSessionId,
		);
	});

	// When the tab unmounts entirely (e.g. session destroyed or panel
	// torn down) clear the store so we don't leak the SSE subscription.
	// The lazy-mount contract from RightPanel keeps this rare but real.
	onDestroy(() => {
		fileChangesStore.setActiveSession(null, null);
	});

	// ── Grouping ───────────────────────────────────────────────────────────

	type Group = { type: FileChangeType; label: string; items: FileChange[] };

	const groups = $derived<Group[]>(buildGroups(fileChangesStore.changes));

	function buildGroups(changes: FileChange[]): Group[] {
		const created: FileChange[] = [];
		const modified: FileChange[] = [];
		const deleted: FileChange[] = [];
		for (const change of changes) {
			if (change.changeType === 'created') created.push(change);
			else if (change.changeType === 'modified') modified.push(change);
			else deleted.push(change);
		}
		// Render order: created → modified → deleted. Each section is
		// hidden when empty (matches MH5 spec language: "no deleted
		// section shown if 0").
		const out: Group[] = [];
		if (created.length > 0) out.push({ type: 'created', label: 'Created', items: created });
		if (modified.length > 0) out.push({ type: 'modified', label: 'Modified', items: modified });
		if (deleted.length > 0) out.push({ type: 'deleted', label: 'Deleted', items: deleted });
		return out;
	}

	const totalCount = $derived(fileChangesStore.changes.length);
	const isEmpty = $derived(!fileChangesStore.isLoading && totalCount === 0);

	// ── Path formatting ────────────────────────────────────────────────────
	//
	// Spec asks for paths "truncated at 40 chars with ellipsis on the
	// left (show filename + parent dir)". We always preserve the trailing
	// `parentDir/filename` so users can identify the file at a glance.
	const PATH_MAX = 40;

	function formatPath(path: string): string {
		if (path.length <= PATH_MAX) return path;
		const segments = path.split('/');
		const filename = segments[segments.length - 1] ?? path;
		const parent = segments.length >= 2 ? segments[segments.length - 2] : '';
		const tail = parent ? `${parent}/${filename}` : filename;
		// If even the filename + parent overflow, truncate the visible
		// portion from the left and prepend the ellipsis. Guarantees the
		// filename remains visible in full whenever possible.
		if (tail.length >= PATH_MAX) {
			return `…${tail.slice(-(PATH_MAX - 1))}`;
		}
		return `…/${tail}`;
	}

	// ── Relative time formatting ───────────────────────────────────────────

	const RELATIVE_TIME_FMT = new Intl.RelativeTimeFormat(undefined, {
		numeric: 'auto',
		style: 'short',
	});

	// Reactive ticker so already-rendered timestamps creep forward without
	// requiring a new SSE event. 30s cadence keeps "just now" → "1m ago"
	// updates timely without churning the DOM.
	let nowTick = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => {
			nowTick = Date.now();
		}, 30_000);
		return () => clearInterval(id);
	});

	function formatRelative(ms: number): string {
		const diffSeconds = Math.round((ms - nowTick) / 1000);
		const absSeconds = Math.abs(diffSeconds);
		if (absSeconds < 45) return RELATIVE_TIME_FMT.format(diffSeconds, 'second');
		const diffMinutes = Math.round(diffSeconds / 60);
		if (Math.abs(diffMinutes) < 60) return RELATIVE_TIME_FMT.format(diffMinutes, 'minute');
		const diffHours = Math.round(diffMinutes / 60);
		if (Math.abs(diffHours) < 24) return RELATIVE_TIME_FMT.format(diffHours, 'hour');
		const diffDays = Math.round(diffHours / 24);
		return RELATIVE_TIME_FMT.format(diffDays, 'day');
	}

	function iconFor(type: FileChangeType): typeof EditIcon {
		if (type === 'created') return PlusIcon;
		if (type === 'deleted') return DeleteIcon;
		return EditIcon;
	}

	// ── Diff overlay ───────────────────────────────────────────────────────
	//
	// Per the W3 question resolution noted in BLUEPRINT (Q2), the diff
	// renders as an in-panel overlay that covers the tab content. This
	// keeps users inside the right panel rather than punting them to a
	// modal or a route — the tab's keep-alive lifecycle survives the
	// overlay open/close cycle.

	let openChange = $state<FileChange | null>(null);
	let afterContent = $state<string | null>(null);
	let afterLoading = $state(false);
	let afterMessage = $state<string | null>(null);

	async function openDiff(change: FileChange): Promise<void> {
		openChange = change;
		afterContent = null;
		afterMessage = null;

		// Deleted files have no "after" — short-circuit to empty content.
		if (change.changeType === 'deleted') {
			afterContent = '';
			return;
		}

		afterLoading = true;
		const result = await fileChangesStore.fetchFileContent(change.path);
		// Race guard: the user may have closed or switched files.
		if (openChange !== change) return;
		afterLoading = false;
		if (result === null) {
			afterContent = '';
			afterMessage = fileChangesStore.lastError
				? `Could not load current contents: ${fileChangesStore.lastError}`
				: 'Could not load current file contents.';
		} else {
			afterContent = result;
		}
	}

	function closeDiff(): void {
		openChange = null;
		afterContent = null;
		afterLoading = false;
		afterMessage = null;
	}

	function onOverlayKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeDiff();
		}
	}

	const diffBefore = $derived(openChange?.snapshot ?? '');
	const diffAfter = $derived(afterContent ?? '');

	function languageHintFor(path: string): string {
		const ext = path.split('.').pop()?.toLowerCase();
		if (!ext) return 'text';
		switch (ext) {
			case 'ts':
			case 'tsx':
				return 'typescript';
			case 'js':
			case 'jsx':
				return 'javascript';
			case 'json':
				return 'json';
			case 'md':
				return 'markdown';
			case 'svelte':
				return 'html';
			case 'css':
				return 'css';
			case 'html':
				return 'html';
			default:
				return 'text';
		}
	}
</script>

<div class="files-tab">
	{#if isEmpty}
		<div class="empty-state" role="status">
			<HugeiconsIcon icon={EditIcon} size={28} strokeWidth={1.4} />
			<p>No file changes in this session yet.</p>
			<p class="empty-hint">Write, edit, and patch tools will appear here.</p>
		</div>
	{:else}
		{#if fileChangesStore.lastError && totalCount === 0}
			<div class="error-banner" role="alert">
				{fileChangesStore.lastError}
			</div>
		{/if}

		<ul class="groups" aria-label="File changes by type">
			{#each groups as group (group.type)}
				<li class="group">
					<header class="group-header">
						<span class="group-label">{group.label}</span>
						<span class="group-count">({group.items.length})</span>
					</header>
					<ul class="entries" aria-label={`${group.label} files`}>
						{#each group.items as change (change.path)}
							<li class="entry">
								<button
									type="button"
									class="entry-button"
									onclick={() => openDiff(change)}
									aria-label={`View diff for ${change.path}, ${group.label.toLowerCase()} ${formatRelative(change.lastTouchedAt)}`}
									title={change.path}
								>
									<span class="entry-icon" data-type={change.changeType} aria-hidden="true">
										<HugeiconsIcon
											icon={iconFor(change.changeType)}
											size={14}
											strokeWidth={1.6}
										/>
									</span>
									<span class="entry-path">{formatPath(change.path)}</span>
									<time class="entry-time" datetime={new Date(change.lastTouchedAt).toISOString()}>
										{formatRelative(change.lastTouchedAt)}
									</time>
									<span class="entry-action" aria-hidden="true">
										<HugeiconsIcon icon={ViewIcon} size={14} strokeWidth={1.4} />
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	{/if}

	{#if openChange}
		<!-- Overlay covers the .files-tab fill area. Esc + close button
		     both restore the tab content; clicking through to DiffViewer
		     does not close (users may want to scroll/inspect at length). -->
		<div
			class="diff-overlay"
			role="dialog"
			aria-modal="true"
			aria-label={`Diff: ${openChange.path}`}
			onkeydown={onOverlayKeydown}
			tabindex="-1"
		>
			<header class="diff-header">
				<div class="diff-title">
					<span class="diff-type-badge" data-type={openChange.changeType}>
						{openChange.changeType}
					</span>
					<span class="diff-path" title={openChange.path}>{openChange.path}</span>
				</div>
				<button
					type="button"
					class="diff-close"
					onclick={closeDiff}
					aria-label="Close diff viewer"
				>
					<HugeiconsIcon icon={CloseIcon} size={16} strokeWidth={1.6} />
				</button>
			</header>

			<div class="diff-body">
				{#if afterLoading}
					<p class="diff-status">Loading current file contents…</p>
				{:else}
					{#if afterMessage}
						<p class="diff-status diff-status-warn">{afterMessage}</p>
					{/if}
					<DiffViewer
						original={diffBefore}
						modified={diffAfter}
						language={languageHintFor(openChange.path)}
						mode="unified"
					/>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.files-tab {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3) var(--space-3) var(--space-4);
		gap: var(--space-3);
	}

	/* ─── Empty state ───────────────────────────────────────────────── */

	.empty-state {
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

	.empty-state p {
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.empty-hint {
		color: var(--text-muted);
		font-weight: 400;
		font-size: 12px;
	}

	.error-banner {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background-color: var(--color-primary-subtle);
		color: var(--text-prose);
		border: 1px solid var(--border-edge);
		font-size: 12px;
	}

	/* ─── Grouped lists ─────────────────────────────────────────────── */

	.groups {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.group-header {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: 0 var(--space-1);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-meta);
	}

	.group-count {
		color: var(--text-muted);
		font-weight: 500;
	}

	.entries {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.entry {
		margin: 0;
		padding: 0;
	}

	.entry-button {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-2);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-prose);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.entry-button:hover {
		background-color: var(--surface-hover);
	}

	.entry-button:focus-visible {
		outline: none;
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus, 0 0 0 2px var(--color-primary-subtle));
	}

	.entry-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-xs);
		color: var(--text-meta);
	}

	/* Per-type accent on the leading glyph — colour the icon, leave the
	   row chrome neutral so the panel does not feel like a traffic light. */
	.entry-icon[data-type='created'] {
		color: var(--color-success);
	}
	.entry-icon[data-type='modified'] {
		color: var(--color-info);
	}
	.entry-icon[data-type='deleted'] {
		color: var(--color-error);
	}

	.entry-path {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-prose);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.entry-time {
		font-size: 11px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.entry-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		opacity: 0;
		transition: opacity var(--transition-fast);
	}

	.entry-button:hover .entry-action,
	.entry-button:focus-visible .entry-action {
		opacity: 1;
	}

	/* ─── Diff overlay ──────────────────────────────────────────────── */

	.diff-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background-color: var(--surface-plate);
		z-index: var(--z-modal);
		/* The overlay rises above the scrolling list inside .files-tab.
		   We keep it positioned: absolute against .files-tab so it fills
		   the tab content area only — the panel header and footer stay
		   visible per spec. */
	}

	.diff-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border-edge);
		background-color: var(--surface-leaf);
	}

	.diff-title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		flex: 1 1 auto;
	}

	.diff-type-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px var(--space-2);
		border-radius: var(--radius-full);
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background-color: var(--color-primary-subtle);
		color: var(--text-prose);
	}

	.diff-type-badge[data-type='created'] {
		background-color: rgba(34, 197, 94, 0.16);
		color: var(--color-success);
	}
	.diff-type-badge[data-type='modified'] {
		background-color: rgba(59, 130, 246, 0.16);
		color: var(--color-info);
	}
	.diff-type-badge[data-type='deleted'] {
		background-color: rgba(239, 68, 68, 0.16);
		color: var(--color-error);
	}

	.diff-path {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-prose);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.diff-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-meta);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.diff-close:hover {
		background-color: var(--surface-hover);
		color: var(--text-prose);
	}

	.diff-close:focus-visible {
		outline: none;
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus, 0 0 0 2px var(--color-primary-subtle));
	}

	.diff-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.diff-status {
		margin: 0;
		font-size: 12px;
		color: var(--text-meta);
	}

	.diff-status-warn {
		color: var(--color-warning);
	}
</style>
