<!--
@component
SpecModeView — top-level surface for the Spec Mode panel.

Layout: WorkflowSwitcher + PhaseRail in a thin sidebar, main content area
with a tab toggle to switch between the SpecViewer and the WaveTaskBoard.

Behavior:
  - On mount, calls specModeStore.loadWorkflows for the active project and
    starts an SSE subscription that updates the store as the daemon emits
    spec-mode events (phase transitions, lock, wave / task changes).
  - Cleanly tears down the subscription on unmount.

Accessibility:
  - Skipped headings; landmarks via role="region" on each section.
  - The view-toggle is a tablist matching SpecViewer's tab pattern.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { specModeStore } from '$lib/stores/spec-mode.svelte.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { DAEMON_URL } from '$lib/daemon/client.js';
	import WorkflowSwitcher from './WorkflowSwitcher.svelte';
	import PhaseRail from './PhaseRail.svelte';
	import SpecViewer from './SpecViewer.svelte';
	import WaveTaskBoard from './WaveTaskBoard.svelte';
	import { HugeiconsIcon, WarningIcon, InfoIcon } from '$lib/icons/index.js';

	type View = 'spec' | 'tasks';

	let activeView = $state<View>('spec');
	let unsubscribe: (() => void) | null = null;
	let legacyMode = $state(false);

	const projectId = $derived(projectsStore.activeProjectId);

	async function checkLegacyMode(id: string): Promise<void> {
		try {
			const response = await fetch(`${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/settings`);
			if (response.ok) {
				const json = (await response.json()) as { ok: true; data: { legacyStateMode: boolean } } | { ok: false };
				legacyMode = 'data' in json ? json.data.legacyStateMode : false;
			}
		} catch {
			legacyMode = false;
		}
	}

	$effect(() => {
		const id = projectId;
		if (!id) return;
		void checkLegacyMode(id);
		void specModeStore.loadWorkflows(id);
		// Tear down the prior subscription before reconnecting on project switch.
		if (unsubscribe) unsubscribe();
		unsubscribe = specModeStore.subscribeToSpecEvents(id);
	});

	onDestroy(() => {
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}
	});
</script>

<div
	class="flex h-full w-full flex-col gap-3 bg-gray-50 p-4 dark:bg-gray-950"
	data-testid="spec-mode-view"
>
	{#if !projectId}
		<div class="flex h-full items-center justify-center">
			<p class="text-sm text-gray-500 dark:text-gray-400">
				Open a project to view its spec workflows.
			</p>
		</div>
	{:else if legacyMode}
		<div
			role="alert"
			class="rounded-md border border-amber-300 bg-amber-50 px-4 py-6 text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-100"
		>
			<div class="flex items-start gap-3">
				<HugeiconsIcon icon={InfoIcon} size={18} strokeWidth={1.5} />
				<div>
					<p class="text-sm font-semibold">Legacy mode — Spec Mode disabled</p>
					<p class="mt-1 text-xs">
						This project is configured to use <code>.elefant/state.json</code> for
						workflow state. Disable "Use legacy state.json" in Settings → Project to
						enable Spec Mode.
					</p>
				</div>
			</div>
		</div>
	{:else}
		<header class="flex flex-col gap-3 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
			<div class="flex items-center justify-between gap-3">
				<div class="min-w-[16rem] flex-1 max-w-md">
					<WorkflowSwitcher {projectId} />
				</div>
				<div
					role="tablist"
					aria-label="Spec mode panel view"
					class="flex shrink-0 items-center gap-1 rounded-md bg-gray-100 p-1 dark:bg-gray-800"
				>
					{#each [
						{ id: 'spec' as const, label: 'Spec' },
						{ id: 'tasks' as const, label: 'Tasks' },
					] as item (item.id)}
						<button
							type="button"
							role="tab"
							aria-selected={activeView === item.id}
							aria-label={`View ${item.label}`}
							class={[
								'rounded px-3 py-1 text-xs font-medium',
								activeView === item.id
									? 'bg-white text-emerald-700 shadow-sm dark:bg-gray-900 dark:text-emerald-300'
									: 'text-gray-600 hover:bg-white/60 dark:text-gray-400 dark:hover:bg-gray-700/40',
							].join(' ')}
							onclick={() => (activeView = item.id)}
						>
							{item.label}
						</button>
					{/each}
				</div>
			</div>
			<PhaseRail />
		</header>

		{#if specModeStore.error}
			<div
				role="alert"
				class="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-300"
			>
				<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
				<span>{specModeStore.error}</span>
			</div>
		{/if}

		<main class="flex-1 min-h-0">
			{#if specModeStore.workflows.length === 0 && !specModeStore.loading}
				<div class="flex h-full items-center justify-center rounded-md border border-dashed border-gray-300 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-900">
					<div>
						<p class="text-sm font-medium text-gray-900 dark:text-gray-100">No workflows yet</p>
						<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
							Create one with the workflow switcher above to begin.
						</p>
					</div>
				</div>
			{:else if activeView === 'spec'}
				<div class="h-full">
					<SpecViewer />
				</div>
			{:else}
				<div class="h-full">
					<WaveTaskBoard />
				</div>
			{/if}
		</main>
	{/if}
</div>
