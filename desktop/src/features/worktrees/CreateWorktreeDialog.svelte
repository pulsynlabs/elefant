<script lang="ts">
	import type { CreateWorktreeInput } from '$lib/types/worktree.js'

	type Props = {
		projectName: string
		onCancel: () => void
		onConfirm: (input: CreateWorktreeInput) => void | Promise<void>
	}

	let { projectName, onCancel, onConfirm }: Props = $props()

	let branch = $state('')
	let base = $state('')
	let targetPath = $state('')
	let touched = $state(false)

	$effect(() => {
		const normalizedBranch = branch.trim().replace(/\s+/g, '-')
		if (!touched && normalizedBranch) {
			targetPath = `../${projectName}-${normalizedBranch}`
		}
	})

	const branchError = $derived(
		branch.trim().length === 0 ? 'Branch is required' : null,
	)
	const targetPathError = $derived(
		targetPath.trim().length === 0 ? 'Target path is required' : null,
	)

	async function submit(event: Event): Promise<void> {
		event.preventDefault()
		if (branchError || targetPathError) return

		await onConfirm({
			branch: branch.trim(),
			targetPath: targetPath.trim(),
			base: base.trim() || undefined,
		})
	}
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onCancel()}>
	<form class="dialog" role="dialog" aria-modal="true" aria-labelledby="create-worktree-title" onsubmit={submit}>
		<h2 id="create-worktree-title">Create worktree</h2>

		<label>
			<span>Branch name</span>
			<input type="text" bind:value={branch} placeholder="feature/my-branch" />
			{#if branchError}
				<small class="error">{branchError}</small>
			{/if}
		</label>

		<label>
			<span>Target path</span>
			<input
				type="text"
				bind:value={targetPath}
				oninput={() => (touched = true)}
				placeholder="../project-feature"
			/>
			{#if targetPathError}
				<small class="error">{targetPathError}</small>
			{/if}
		</label>

		<label>
			<span>Base branch (optional)</span>
			<input type="text" bind:value={base} placeholder="main" />
		</label>

		<div class="actions">
			<button type="button" class="ghost" onclick={onCancel}>Cancel</button>
			<button type="submit" class="primary">Create</button>
		</div>
	</form>
</div>

<style>
	.backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--color-bg) 70%, transparent); z-index: 1000; }
	.dialog { width: min(480px, calc(100vw - 2rem)); background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); display: grid; gap: var(--space-3); }
	label { display: grid; gap: var(--space-1); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
	input { border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text-primary); padding: var(--space-2) var(--space-3); }
	.error { color: var(--color-error, #ef4444); }
	.actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
	button { border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); cursor: pointer; }
	button.primary { background: var(--color-primary, #3b82f6); color: var(--color-primary-foreground, #fff); border-color: var(--color-primary, #3b82f6); }
	button.ghost { background: transparent; color: var(--color-text-primary); }
</style>
