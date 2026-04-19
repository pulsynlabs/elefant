<script lang="ts">
	import { projectsStore } from '$lib/stores/projects.svelte.js'
	import { worktreesStore } from '$lib/stores/worktrees.svelte.js'
	import type { WorktreeSummary } from '$lib/types/worktree.js'
	import CreateWorktreeDialog from './CreateWorktreeDialog.svelte'
	import DeleteWorktreeDialog from './DeleteWorktreeDialog.svelte'
	import WorktreeRow from './WorktreeRow.svelte'

	const projectId = $derived(projectsStore.activeProjectId)
	const projectName = $derived(projectsStore.activeProject?.name ?? 'project')
	const worktrees = $derived(projectId ? worktreesStore.byProjectId[projectId] ?? [] : [])
	const isLoading = $derived(projectId ? worktreesStore.isLoadingByProject[projectId] === true : false)

	let showCreateDialog = $state(false)
	let deleting = $state<WorktreeSummary | null>(null)

	$effect(() => {
		if (projectId) {
			void worktreesStore.refresh(projectId)
		}
	})

	async function createWorktree(input: { targetPath: string; branch: string; base?: string }): Promise<void> {
		if (!projectId) return
		const created = await worktreesStore.create(projectId, input)
		if (created) {
			showCreateDialog = false
			worktreesStore.setActiveWorktree(created.path)
		}
	}

	async function deleteWorktree(force: boolean): Promise<void> {
		if (!projectId || !deleting) return
		const deleted = await worktreesStore.delete(projectId, deleting.path, force)
		if (deleted) {
			deleting = null
		}
	}

	async function prune(): Promise<void> {
		if (!projectId) return
		await worktreesStore.prune(projectId)
	}
</script>

<section class="panel" aria-label="Project worktrees">
	<header class="header">
		<div>
			<h3>Worktrees</h3>
			<p>Manage parallel branches as isolated directories.</p>
		</div>
		<div class="header-actions">
			<button type="button" class="ghost" onclick={prune} disabled={!projectId}>Prune</button>
			<button type="button" class="primary" onclick={() => (showCreateDialog = true)} disabled={!projectId}>New</button>
		</div>
	</header>

	{#if !projectId}
		<div class="empty">Select a project to manage worktrees.</div>
	{:else if isLoading}
		<div class="empty">Loading worktrees…</div>
	{:else if worktreesStore.lastError}
		<div class="error" role="alert">{worktreesStore.lastError}</div>
	{:else if worktrees.length === 0}
		<div class="empty">No worktrees yet. Create your first one.</div>
	{:else}
		<div class="list">
			{#each worktrees as worktree (worktree.path)}
				<WorktreeRow
					{worktree}
					isActive={worktreesStore.activeWorktreeId === worktree.path}
					onSwitch={worktreesStore.setActiveWorktree}
					onDelete={(item) => (deleting = item)}
				/>
			{/each}
		</div>
	{/if}
</section>

{#if showCreateDialog}
	<CreateWorktreeDialog
		projectName={projectName.toLowerCase().replace(/\s+/g, '-')}
		onCancel={() => (showCreateDialog = false)}
		onConfirm={createWorktree}
	/>
{/if}

{#if deleting}
	<DeleteWorktreeDialog
		worktree={deleting}
		onCancel={() => (deleting = null)}
		onConfirm={deleteWorktree}
	/>
{/if}

<style>
	.panel { display: grid; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
	.header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
	h3 { margin: 0; font-size: var(--font-size-base); }
	p { margin: 0; color: var(--color-text-muted); font-size: var(--font-size-xs); }
	.header-actions { display: flex; gap: var(--space-2); }
	button { border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); cursor: pointer; }
	button.primary { background: var(--color-primary, #3b82f6); color: var(--color-primary-foreground, #fff); border-color: var(--color-primary, #3b82f6); }
	button.ghost { background: transparent; color: var(--color-text-primary); }
	button:disabled { opacity: 0.5; cursor: not-allowed; }
	.list { display: grid; gap: var(--space-2); }
	.empty { color: var(--color-text-muted); font-size: var(--font-size-sm); padding: var(--space-2); }
	.error { color: var(--color-error, #ef4444); font-size: var(--font-size-sm); padding: var(--space-2); background: color-mix(in srgb, var(--color-error, #ef4444) 14%, transparent); border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 35%, transparent); border-radius: var(--radius-sm); }
</style>
