<!--
@component
SpecViewer — five-tab document viewer for spec-mode artifacts.

Tabs: Requirements | Spec | Blueprint | Chronicle | ADL

Each tab fetches rendered markdown from
  GET /api/spec/workflows/:id/render/:docType
via specModeStore.loadRendered. We display the markdown as <pre> with
white-space: pre-wrap so it's readable without pulling in a new
markdown-rendering dep — this is intentionally lightweight for the GUI
MVP. The chat surface already has a richer renderer; we can swap in
later if needed.

Lock affordance:
  - When the workflow is in `specify` or later AND not yet locked, a
    "Lock Spec" button appears on the Spec tab. Clicking shows an
    inline confirmation, and confirming calls specModeStore.lockSpec.
  - When locked, an "Amend" button toggles a small panel for
    rationale entry.

Accessibility:
  - Tablist follows the WAI-ARIA tabs pattern (role="tab",
    aria-selected, role="tabpanel" with aria-labelledby).
  - All buttons carry aria-label describing intent.
-->
<script lang="ts">
	import { specModeStore } from '$lib/stores/spec-mode.svelte.js';
	import {
		HugeiconsIcon,
		CheckIcon,
		WarningIcon,
		EditIcon,
	} from '$lib/icons/index.js';
	import LockIcon from '@hugeicons/core-free-icons/SquareLock02Icon';

	const DOC_TYPES = [
		{ id: 'requirements', label: 'Requirements' },
		{ id: 'spec', label: 'Spec' },
		{ id: 'blueprint', label: 'Blueprint' },
		{ id: 'chronicle', label: 'Chronicle' },
		{ id: 'adl', label: 'ADL' },
	] as const;
	type DocType = (typeof DOC_TYPES)[number]['id'];

	let activeTab = $state<DocType>('spec');
	let confirmingLock = $state(false);
	let amending = $state(false);
	let amendRationale = $state('');
	let amendError = $state<string | null>(null);
	let loadAttempts = $state<Record<DocType, number>>({
		requirements: 0,
		spec: 0,
		blueprint: 0,
		chronicle: 0,
		adl: 0,
	});

	const activeWorkflow = $derived(specModeStore.activeWorkflow);
	const isLocked = $derived(activeWorkflow?.specLocked ?? false);
	// "specify" and later phases are eligible for lock
	const canLock = $derived(
		!isLocked &&
			activeWorkflow !== null &&
			['specify', 'execute', 'audit', 'accept'].includes(activeWorkflow.phase),
	);

	const renderedContent = $derived<string>(specModeStore.renderedDocs[activeTab] ?? '');
	const loadingDoc = $derived(
		specModeStore.loading && renderedContent === '',
	);

	function changeTab(next: DocType): void {
		activeTab = next;
		void ensureLoaded();
	}

	async function ensureLoaded(): Promise<void> {
		const wf = specModeStore.activeWorkflowId;
		if (!wf) return;
		// Only fetch on first visit per (workflow, docType) — store caches
		if (specModeStore.renderedDocs[activeTab] !== undefined) return;
		loadAttempts = { ...loadAttempts, [activeTab]: loadAttempts[activeTab] + 1 };
		await specModeStore.loadRendered(wf, activeTab);
	}

	$effect(() => {
		// Re-fetch whenever active workflow changes (changes invalidate cache).
		const id = specModeStore.activeWorkflowId;
		if (id) void ensureLoaded();
	});

	async function confirmLock(): Promise<void> {
		const wf = specModeStore.activeWorkflowId;
		if (!wf) return;
		await specModeStore.lockSpec(wf);
		confirmingLock = false;
	}

	function startAmend(): void {
		amending = true;
		amendRationale = '';
		amendError = null;
	}

	async function submitAmend(): Promise<void> {
		// The amend route requires daemon route work beyond MVP — for now we
		// surface a friendly notice that amendments need a full payload.
		// This keeps the affordance in place without silently failing.
		amendError = 'Amendments require a structured payload — use the chat surface for now.';
	}

	function retry(): void {
		const wf = specModeStore.activeWorkflowId;
		if (!wf) return;
		// Force a re-fetch by clearing the cached entry
		void specModeStore.loadRendered(wf, activeTab);
	}
</script>

<section class="flex h-full flex-col rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" aria-label="Spec documents">
	<!-- Tabs -->
	<div role="tablist" aria-label="Spec mode documents" class="flex shrink-0 items-center gap-1 border-b border-gray-100 px-2 py-1 dark:border-gray-800">
		{#each DOC_TYPES as doc (doc.id)}
			<button
				type="button"
				role="tab"
				id={`tab-${doc.id}`}
				aria-selected={activeTab === doc.id}
				aria-controls={`panel-${doc.id}`}
				aria-label={`View ${doc.label}`}
				tabindex={activeTab === doc.id ? 0 : -1}
				class={[
					'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
					activeTab === doc.id
						? 'bg-emerald-600 text-white shadow-sm'
						: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
				].join(' ')}
				onclick={() => changeTab(doc.id)}
			>
				{doc.label}
				{#if doc.id === 'spec' && isLocked}
					<span class="ml-1 inline-flex items-center" aria-label="locked">
						<HugeiconsIcon icon={LockIcon} size={11} strokeWidth={1.5} />
					</span>
				{/if}
			</button>
		{/each}

		<!-- Spec-tab actions live in the toolbar so they're always reachable -->
		{#if activeTab === 'spec'}
			<div class="ml-auto flex items-center gap-2">
				{#if canLock}
					{#if confirmingLock}
						<span class="text-xs text-gray-500 dark:text-gray-400">Lock spec?</span>
						<button
							type="button"
							class="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
							onclick={confirmLock}
							aria-label="Confirm lock spec"
						>
							<HugeiconsIcon icon={CheckIcon} size={11} strokeWidth={2} />
							Confirm
						</button>
						<button
							type="button"
							class="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
							onclick={() => (confirmingLock = false)}
							aria-label="Cancel lock"
						>
							Cancel
						</button>
					{:else}
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-md border border-emerald-600 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
							onclick={() => (confirmingLock = true)}
							aria-label="Lock specification"
						>
							<HugeiconsIcon icon={LockIcon} size={11} strokeWidth={1.5} />
							Lock Spec
						</button>
					{/if}
				{/if}

				{#if isLocked}
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded-md border border-amber-500 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/30"
						onclick={startAmend}
						aria-label="Amend specification"
					>
						<HugeiconsIcon icon={EditIcon} size={11} strokeWidth={1.5} />
						Amend
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if amending && activeTab === 'spec'}
		<div class="border-b border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-900/20">
			<label class="block text-xs font-medium text-amber-800 dark:text-amber-300" for="amend-rationale">
				Amendment rationale
			</label>
			<textarea
				id="amend-rationale"
				bind:value={amendRationale}
				rows={2}
				class="mt-1 w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs focus:border-amber-500 focus:outline-none dark:border-amber-700/50 dark:bg-gray-900 dark:text-gray-100"
				placeholder="Why is this change needed?"
				aria-label="Amendment rationale"
			></textarea>
			{#if amendError}
				<p class="mt-1 text-xs text-amber-700 dark:text-amber-300" role="alert">{amendError}</p>
			{/if}
			<div class="mt-2 flex gap-2">
				<button
					type="button"
					class="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
					onclick={submitAmend}
					disabled={amendRationale.trim().length === 0}
					aria-label="Submit amendment"
				>
					Submit
				</button>
				<button
					type="button"
					class="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
					onclick={() => (amending = false)}
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}

	<!-- Tab panel -->
	<div
		role="tabpanel"
		id={`panel-${activeTab}`}
		aria-labelledby={`tab-${activeTab}`}
		class="flex-1 overflow-y-auto p-4"
	>
		{#if loadingDoc && loadAttempts[activeTab] > 0}
			<div class="space-y-2" aria-busy="true" aria-label="Loading document">
				<div class="h-3 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-3 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-3 w-5/6 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			</div>
		{:else if specModeStore.error && renderedContent === ''}
			<div role="alert" class="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
				<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
				<div>
					<p>Failed to load {activeTab}.</p>
					<button
						type="button"
						class="mt-1 rounded border border-red-300 px-2 py-1 text-xs hover:bg-red-50 dark:border-red-700/50 dark:hover:bg-red-900/20"
						onclick={retry}
						aria-label={`Retry loading ${activeTab}`}
					>
						Retry
					</button>
				</div>
			</div>
		{:else if renderedContent === ''}
			<p class="text-sm italic text-gray-500 dark:text-gray-400">
				No {activeTab} content yet.
			</p>
		{:else}
			<pre
				class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-800 dark:text-gray-200"
			>{renderedContent}</pre>
		{/if}
	</div>
</section>
