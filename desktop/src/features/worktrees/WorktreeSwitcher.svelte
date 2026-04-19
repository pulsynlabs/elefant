<script lang="ts">
	import { projectsStore } from '$lib/stores/projects.svelte.js'
	import { worktreesStore } from '$lib/stores/worktrees.svelte.js'

	const currentProjectId = $derived(projectsStore.activeProjectId)
	const options = $derived(
		currentProjectId ? worktreesStore.byProjectId[currentProjectId] ?? [] : [],
	)

	function onChange(event: Event): void {
		const value = (event.currentTarget as HTMLSelectElement).value
		worktreesStore.setActiveWorktree(value || null)
	}
</script>

<label class="switcher">
	<span class="label">Worktree</span>
	<select value={worktreesStore.activeWorktreeId ?? ''} onchange={onChange}>
		<option value="">Default</option>
		{#each options as option (option.path)}
			<option value={option.path}>{option.branch ?? '(detached)'}</option>
		{/each}
	</select>
</label>

<style>
	.switcher { display: inline-flex; align-items: center; gap: var(--space-2); }
	.label { font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
	select {
		height: 32px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-primary);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-2);
		font-size: var(--font-size-sm);
	}
</style>
