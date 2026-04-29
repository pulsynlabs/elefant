<!--
@component
WaveTaskBoard — kanban-style task board scoped to the active wave of the
active workflow. Reads from the spec-mode store and reacts to live SSE
updates pushed by the daemon's spec-mode publisher.

Columns: Pending | In Progress | Done | Blocked (Blocked only shows if any)

Tasks come from `specModeStore.tasks`. Each card surfaces:
  - task_id (e.g. "W2.T3")
  - friendly name
  - executor tier badge (color-coded)
  - status indicator dot

Clicking a card expands it inline to show action / done / verify text.

Wave controls:
  - "Start Wave" appears when no task in this wave is in progress.
  - "Complete Wave" appears when every task in the wave is done.

Accessibility:
  - aria-label on the board names the active wave.
  - Each column is a region with its own aria-label.
  - Cards are buttons (role=button, keyboard activatable).
-->
<script lang="ts">
	import { specModeStore, type SpecModeTask } from '$lib/stores/spec-mode.svelte.js';
	import {
		HugeiconsIcon,
		CheckIcon,
		RunsIcon,
	} from '$lib/icons/index.js';

	const TIER_COLORS: Record<string, string> = {
		low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
		medium: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
		high: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200',
		frontend: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
	};

	const STATUS_COLORS: Record<string, string> = {
		pending: 'bg-gray-300 dark:bg-gray-600',
		in_progress: 'bg-amber-400 dark:bg-amber-300 animate-pulse',
		done: 'bg-emerald-500 dark:bg-emerald-400',
		blocked: 'bg-red-500 dark:bg-red-400',
	};

	let expandedTaskId = $state<string | null>(null);
	let waveActionInFlight = $state(false);

	const activeWorkflow = $derived(specModeStore.activeWorkflow);
	const currentWave = $derived(activeWorkflow?.currentWave ?? 0);

	const waveTasks = $derived<SpecModeTask[]>(
		specModeStore.tasks.filter((t) => {
			// We don't have explicit wave_number on the row in the task summary;
			// the daemon's task list is already scoped server-side when possible.
			// As a safe default, render every task and group by status.
			return true;
		}),
	);

	const grouped = $derived<Record<string, SpecModeTask[]>>({
		pending: waveTasks.filter((t) => t.status === 'pending'),
		in_progress: waveTasks.filter((t) => t.status === 'in_progress'),
		done: waveTasks.filter((t) => t.status === 'done'),
		blocked: waveTasks.filter((t) => t.status === 'blocked'),
	});

	const showBlockedColumn = $derived(grouped.blocked.length > 0);

	const canStartWave = $derived(
		waveTasks.length > 0 && grouped.in_progress.length === 0 && grouped.done.length < waveTasks.length,
	);
	const canCompleteWave = $derived(
		waveTasks.length > 0 && grouped.done.length === waveTasks.length,
	);

	function tierBadge(tier: string): string {
		return TIER_COLORS[tier] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
	}

	function statusDot(status: string): string {
		return STATUS_COLORS[status] ?? 'bg-gray-300 dark:bg-gray-600';
	}

	function toggleExpand(taskId: string): void {
		expandedTaskId = expandedTaskId === taskId ? null : taskId;
	}

	async function onStartWave(): Promise<void> {
		const wf = specModeStore.activeWorkflowId;
		if (!wf || waveActionInFlight) return;
		waveActionInFlight = true;
		try {
			await specModeStore.startWave(wf, currentWave);
		} finally {
			waveActionInFlight = false;
		}
	}

	async function onCompleteWave(): Promise<void> {
		const wf = specModeStore.activeWorkflowId;
		if (!wf || waveActionInFlight) return;
		waveActionInFlight = true;
		try {
			await specModeStore.completeWave(wf, currentWave);
		} finally {
			waveActionInFlight = false;
		}
	}

	$effect(() => {
		const id = specModeStore.activeWorkflowId;
		if (id) void specModeStore.loadTasks(id);
	});
</script>

<section
	class="flex h-full flex-col rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
	aria-label={`Wave ${currentWave} task board`}
>
	<header class="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
		<div class="flex items-center gap-2">
			<h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
				Wave {currentWave}{activeWorkflow ? ` / ${activeWorkflow.totalWaves}` : ''}
			</h3>
			<span class="text-xs text-gray-500 dark:text-gray-400">
				{waveTasks.length} task{waveTasks.length === 1 ? '' : 's'}
			</span>
		</div>
		<div class="flex items-center gap-2">
			{#if canStartWave}
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
					onclick={onStartWave}
					disabled={waveActionInFlight}
					aria-label="Start wave"
				>
					<HugeiconsIcon icon={RunsIcon} size={12} strokeWidth={1.5} />
					Start Wave
				</button>
			{/if}
			{#if canCompleteWave}
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
					onclick={onCompleteWave}
					disabled={waveActionInFlight}
					aria-label="Complete wave"
				>
					<HugeiconsIcon icon={CheckIcon} size={12} strokeWidth={2} />
					Complete Wave
				</button>
			{/if}
		</div>
	</header>

	<div
		class={`grid flex-1 gap-3 overflow-y-auto p-3 ${showBlockedColumn ? 'grid-cols-4' : 'grid-cols-3'}`}
	>
		{#each [
			{ key: 'pending', label: 'Pending' },
			{ key: 'in_progress', label: 'In Progress' },
			{ key: 'done', label: 'Done' },
			...(showBlockedColumn ? [{ key: 'blocked', label: 'Blocked' }] : []),
		] as col (col.key)}
			<div
				class="flex flex-col gap-2 rounded-md bg-gray-50 p-2 dark:bg-gray-800/40"
				role="region"
				aria-label={`${col.label} tasks`}
			>
				<div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
					<span>{col.label}</span>
					<span class="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] dark:bg-gray-700">
						{grouped[col.key].length}
					</span>
				</div>

				{#if grouped[col.key].length === 0}
					<p class="text-xs italic text-gray-400 dark:text-gray-500">
						{#if waveTasks.length === 0}
							No tasks for Wave {currentWave}
						{:else}
							—
						{/if}
					</p>
				{:else}
					{#each grouped[col.key] as task (task.id)}
						{@const expanded = expandedTaskId === task.id}
						<button
							type="button"
							class="flex w-full flex-col gap-1 rounded-md border border-gray-200 bg-white p-2 text-left text-xs hover:border-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-500"
							onclick={() => toggleExpand(task.id)}
							aria-expanded={expanded}
							aria-label={`Task ${task.taskId}: ${task.name}`}
						>
							<div class="flex items-center gap-2">
								<span
									class={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDot(task.status)}`}
									aria-hidden="true"
								></span>
								<span class="font-mono text-[10px] text-gray-500 dark:text-gray-400">
									{task.taskId}
								</span>
								<span class={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${tierBadge(task.executor)}`}>
									{task.executor}
								</span>
							</div>
							<div class="text-gray-900 dark:text-gray-100">
								{task.name}
							</div>
							{#if expanded}
								<dl class="mt-1 space-y-1 border-t border-gray-100 pt-1 text-[11px] dark:border-gray-800">
									{#if task.action}
										<div>
											<dt class="font-semibold text-gray-500 dark:text-gray-400">Action</dt>
											<dd class="text-gray-700 dark:text-gray-300">{task.action}</dd>
										</div>
									{/if}
									{#if task.done}
										<div>
											<dt class="font-semibold text-gray-500 dark:text-gray-400">Done</dt>
											<dd class="text-gray-700 dark:text-gray-300">{task.done}</dd>
										</div>
									{/if}
									{#if task.verify}
										<div>
											<dt class="font-semibold text-gray-500 dark:text-gray-400">Verify</dt>
											<dd class="font-mono text-gray-700 dark:text-gray-300">{task.verify}</dd>
										</div>
									{/if}
									{#if task.agentRunId}
										<div>
											<dt class="font-semibold text-gray-500 dark:text-gray-400">Agent run</dt>
											<dd class="font-mono text-gray-700 dark:text-gray-300">{task.agentRunId}</dd>
										</div>
									{/if}
								</dl>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	/* Use plain CSS for grid template responsive fallback when columns count
	   changes dynamically. */
</style>
