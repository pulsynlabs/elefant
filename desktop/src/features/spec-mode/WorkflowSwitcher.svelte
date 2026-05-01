<!--
@component
WorkflowSwitcher — dropdown listing all spec workflows for the active project.
Lets the user pick the active workflow, see its phase + lock status at a glance,
and create new workflows inline. Reads/writes via the spec-mode store.

Accessibility:
  - aria-label on the trigger button names the action ("Switch workflow").
  - The expanded listbox uses role="listbox" with arrow-key navigation.
  - The "New Workflow" form is announced with aria-label.
-->
<script lang="ts">
	import { specModeStore } from '$lib/stores/spec-mode.svelte.js';
	import type { SpecWorkflowSummary } from '$lib/api/workflow.js';
	import {
		HugeiconsIcon,
		ChevronDownIcon,
		PlusIcon,
		CheckIcon,
	} from '$lib/icons/index.js';
	import LockIcon from '@hugeicons/core-free-icons/SquareLock02Icon';

	type Props = {
		projectId: string;
	};

	let { projectId }: Props = $props();

	let isOpen = $state(false);
	let isCreating = $state(false);
	let newWorkflowId = $state('');
	let creating = $state(false);
	let focusedIndex = $state(-1);

	const workflows = $derived(specModeStore.workflows);
	const activeWorkflow = $derived(specModeStore.activeWorkflow);

	function toggle(): void {
		isOpen = !isOpen;
		if (!isOpen) {
			isCreating = false;
			focusedIndex = -1;
		}
	}

	function close(): void {
		isOpen = false;
		isCreating = false;
		focusedIndex = -1;
	}

	function pick(workflow: SpecWorkflowSummary): void {
		const id = workflow.workflowId ?? workflow.id;
		specModeStore.setActiveWorkflow(id);
		close();
	}

	async function submitNew(event: Event): Promise<void> {
		event.preventDefault();
		const id = newWorkflowId.trim();
		if (!id || creating) return;
		creating = true;
		try {
			const created = await specModeStore.createWorkflow(projectId, { workflowId: id });
			if (created) {
				newWorkflowId = '';
				isCreating = false;
				close();
			}
		} finally {
			creating = false;
		}
	}

	function handleKey(event: KeyboardEvent): void {
		if (!isOpen) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}
		if (isCreating) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusedIndex = Math.min(workflows.length, focusedIndex + 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			focusedIndex = Math.max(-1, focusedIndex - 1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (focusedIndex >= 0 && focusedIndex < workflows.length) {
				pick(workflows[focusedIndex]);
			} else if (focusedIndex === workflows.length) {
				isCreating = true;
			}
		}
	}

	function phaseColor(phase: string): string {
		switch (phase) {
			case 'discuss':
				return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200';
			case 'plan':
			case 'specify':
				return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200';
			case 'execute':
				return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
			case 'audit':
				return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200';
			case 'accept':
				return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
			default:
				return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
		}
	}
</script>

<svelte:window onkeydown={handleKey} />

<div class="relative inline-block w-full">
	<button
		type="button"
		class="flex w-full items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
		aria-label="Switch workflow"
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		onclick={toggle}
	>
		<span class="flex min-w-0 items-center gap-2">
			{#if activeWorkflow}
				<span class="truncate">{activeWorkflow.workflowId}</span>
				<span class={`shrink-0 rounded-full px-2 py-0.5 text-xs ${phaseColor(activeWorkflow.phase)}`}>
					{activeWorkflow.phase}
				</span>
				{#if activeWorkflow.specLocked}
					<span class="inline-flex items-center text-amber-600 dark:text-amber-300" aria-label="Spec locked">
						<HugeiconsIcon icon={LockIcon} size={14} strokeWidth={1.5} />
					</span>
				{/if}
			{:else}
				<span class="text-gray-500 dark:text-gray-400">No workflow</span>
			{/if}
		</span>
		<HugeiconsIcon icon={ChevronDownIcon} size={14} strokeWidth={1.5} />
	</button>

	{#if isOpen}
		<ul
			role="listbox"
			class="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
			aria-label="Workflows"
		>
			{#if workflows.length === 0}
				<li class="px-3 py-2 text-sm italic text-gray-500 dark:text-gray-400">
					No workflows yet
				</li>
			{:else}
				{#each workflows as workflow, index (workflow.id)}
					{@const isActive = activeWorkflow?.id === workflow.id}
					<li>
						<button
							type="button"
							role="option"
							aria-selected={isActive}
							class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 focus:bg-gray-100 focus:outline-none dark:hover:bg-gray-800 dark:focus:bg-gray-800"
							class:bg-emerald-50={focusedIndex === index}
							class:dark:bg-emerald-900-30={focusedIndex === index}
							onclick={() => pick(workflow)}
						>
							<span class="flex min-w-0 items-center gap-2">
								{#if isActive}
									<HugeiconsIcon icon={CheckIcon} size={12} strokeWidth={2} />
								{:else}
									<span class="inline-block w-3"></span>
								{/if}
								<span class="truncate font-mono text-xs">{workflow.workflowId}</span>
							</span>
							<span class="flex shrink-0 items-center gap-1.5">
								<span class={`rounded-full px-1.5 py-0.5 text-[10px] ${phaseColor(workflow.phase)}`}>
									{workflow.phase}
								</span>
								{#if workflow.specLocked}
									<span aria-label="Locked" class="text-amber-600 dark:text-amber-300">
										<HugeiconsIcon icon={LockIcon} size={12} strokeWidth={1.5} />
									</span>
								{/if}
							</span>
						</button>
					</li>
				{/each}
			{/if}

			<li class="border-t border-gray-100 dark:border-gray-800">
				{#if isCreating}
					<form class="flex items-center gap-2 px-3 py-2" onsubmit={submitNew} aria-label="Create workflow">
						<input
							type="text"
							class="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
							placeholder="workflow-id"
							bind:value={newWorkflowId}
							aria-label="New workflow id"
							disabled={creating}
						/>
						<button
							type="submit"
							class="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
							disabled={creating || newWorkflowId.trim() === ''}
						>
							{creating ? 'Creating…' : 'Create'}
						</button>
					</form>
				{:else}
					<button
						type="button"
						class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
						onclick={() => (isCreating = true)}
					>
						<HugeiconsIcon icon={PlusIcon} size={14} strokeWidth={1.5} />
						New Workflow
					</button>
				{/if}
			</li>
		</ul>
	{/if}
</div>
