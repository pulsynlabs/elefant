<script lang="ts">
	import { invoke } from '@tauri-apps/api/core'
	import { DeleteIcon, FolderIcon, HugeiconsIcon, TerminalIcon } from '$lib/icons/index.js'
	import type { WorktreeSummary } from '$lib/types/worktree.js'

	type Props = {
		worktree: WorktreeSummary
		isActive?: boolean
		onSwitch: (path: string) => void
		onDelete: (worktree: WorktreeSummary) => void
	}

	let { worktree, isActive = false, onSwitch, onDelete }: Props = $props()

	async function openTerminal(): Promise<void> {
		await invoke('open_terminal_at_path', { path: worktree.path })
	}

	async function revealPath(): Promise<void> {
		await invoke('reveal_in_file_manager', { path: worktree.path })
	}
</script>

<div class="row" class:active={isActive}>
	<button type="button" class="meta" onclick={() => onSwitch(worktree.path)}>
		<span class="dot" class:dirty={worktree.isDirty} aria-label={worktree.isDirty ? 'Dirty' : 'Clean'}></span>
		<div class="text">
			<div class="branch">{worktree.branch ?? '(detached)'}</div>
			<div class="path" title={worktree.path}>{worktree.path}</div>
		</div>
	</button>

	<div class="actions">
		<button type="button" class="icon" onclick={openTerminal} aria-label="Open terminal">
			<HugeiconsIcon icon={TerminalIcon} size={14} strokeWidth={2} />
		</button>
		<button type="button" class="icon" onclick={revealPath} aria-label="Reveal in file manager">
			<HugeiconsIcon icon={FolderIcon} size={14} strokeWidth={2} />
		</button>
		<button type="button" class="icon delete" onclick={() => onDelete(worktree)} aria-label="Delete worktree">
			<HugeiconsIcon icon={DeleteIcon} size={14} strokeWidth={2} />
		</button>
	</div>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
	}

	.row.active {
		border-color: var(--color-border-strong);
		background: var(--color-surface-hover);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: none;
		padding: 0;
		text-align: left;
		min-width: 0;
		cursor: pointer;
		color: var(--color-text-primary);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 9999px;
		background: var(--color-success, #10b981);
		flex-shrink: 0;
	}

	.dot.dirty {
		background: var(--color-warning, #f59e0b);
	}

	.text {
		min-width: 0;
	}

	.branch {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
	}

	.path {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.actions {
		display: flex;
		gap: var(--space-1);
	}

	.icon {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.icon:hover {
		background: var(--color-surface-hover);
		color: var(--color-text-primary);
	}

	.icon.delete:hover {
		color: var(--color-error, #ef4444);
	}
</style>
