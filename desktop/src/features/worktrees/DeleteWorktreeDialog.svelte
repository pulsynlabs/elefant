<script lang="ts">
	import type { WorktreeSummary } from '$lib/types/worktree.js'

	type Props = {
		worktree: WorktreeSummary
		onCancel: () => void
		onConfirm: (force: boolean) => void | Promise<void>
	}

	let { worktree, onCancel, onConfirm }: Props = $props()
	let force = $state(false)

	$effect(() => {
		if (!worktree.isDirty) {
			force = false
		}
	})

	async function submit(event: Event): Promise<void> {
		event.preventDefault()
		await onConfirm(force)
	}
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onCancel()}>
	<form class="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-worktree-title" onsubmit={submit}>
		<h2 id="delete-worktree-title">Delete worktree</h2>
		<p>
			This removes:
			<code>{worktree.path}</code>
		</p>

		{#if worktree.isDirty}
			<p class="warning">This worktree has uncommitted changes. Enable force delete to continue.</p>
			<label class="toggle">
				<input type="checkbox" bind:checked={force} />
				<span>Force delete dirty worktree</span>
			</label>
		{/if}

		<div class="actions">
			<button type="button" class="ghost" onclick={onCancel}>Cancel</button>
			<button type="submit" class="danger" disabled={worktree.isDirty && !force}>Delete</button>
		</div>
	</form>
</div>

<style>
	.backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--color-bg) 70%, transparent); z-index: 1000; }
	.dialog { width: min(480px, calc(100vw - 2rem)); background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); display: grid; gap: var(--space-3); }
	code { font-family: var(--font-mono); font-size: var(--font-size-xs); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 2px 4px; }
	.warning { color: var(--color-warning, #f59e0b); font-size: var(--font-size-sm); }
	.toggle { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
	.actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
	button { border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); cursor: pointer; }
	button.ghost { background: transparent; color: var(--color-text-primary); }
	button.danger { background: var(--color-error, #ef4444); color: white; border-color: var(--color-error, #ef4444); }
	button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
