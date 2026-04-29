<!--
@component
MissionApprovalCard — extends ApprovalPanel's existing per-request rendering
with a "Mission" label tailored to spec-mode approvals (lock-spec, accept-work).

This is a presentational sibling of ApprovalPanel: it doesn't own state, it
just renders one approval row in the Mission style. ApprovalPanel may
delegate to it when the request's tool indicates a spec-mode action; for now
it's importable independently and reads the must-have summary from the
spec-mode store.

Accessibility:
  - aria-label on the wrapper distinguishes mission cards from generic
    approvals so a screen reader hears "Mission approval: ..." rather than
    "Tool approval".
  - Approve / Deny buttons retain the same labels as ApprovalPanel.
-->
<script lang="ts">
	import { specModeStore } from '$lib/stores/spec-mode.svelte.js';
	import { approvalsStore } from '$lib/stores/approvals.svelte.js';
	import { HugeiconsIcon, CheckIcon, CrossIcon } from '$lib/icons/index.js';

	type Props = {
		requestId: string;
		tool: string;
		args: Record<string, unknown>;
	};

	let { requestId, tool, args }: Props = $props();

	const isLockSpec = $derived(tool === 'spec_state' && args?.action === 'lock-spec');
	const isAccept = $derived(tool === 'spec_state' && args?.action === 'confirm-acceptance');

	const missionLabel = $derived(
		isLockSpec ? 'Lock Specification' : isAccept ? 'Accept Work' : 'Spec Mission',
	);

	const mustHaves = $derived<unknown[]>(specModeStore.currentSpec?.mustHaves ?? []);

	function approve(): void {
		approvalsStore.respond(requestId, true);
	}

	function deny(): void {
		approvalsStore.respond(requestId, false, 'user denied');
	}
</script>

<article
	class="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-700/50 dark:bg-emerald-900/20"
	aria-label={`Mission approval: ${missionLabel}`}
>
	<header class="mb-2 flex items-center justify-between">
		<span class="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
			Mission · {missionLabel}
		</span>
		<span class="font-mono text-[10px] text-emerald-700/70 dark:text-emerald-200/60">
			{tool}
		</span>
	</header>

	{#if isLockSpec && mustHaves.length > 0}
		<details class="mb-2">
			<summary class="cursor-pointer text-xs text-emerald-700 dark:text-emerald-300">
				{mustHaves.length} must-have{mustHaves.length === 1 ? '' : 's'} ready to lock
			</summary>
			<ul class="mt-1 space-y-1 border-l-2 border-emerald-300 pl-2 text-xs text-emerald-900 dark:border-emerald-700 dark:text-emerald-100">
				{#each mustHaves as mh, idx (idx)}
					{@const row = mh as { mhId?: string; title?: string }}
					<li class="font-mono">
						{row.mhId ?? `MH${idx + 1}`}: {row.title ?? '(untitled)'}
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	<div class="flex gap-2">
		<button
			type="button"
			class="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
			onclick={approve}
			aria-label={`Approve mission: ${missionLabel}`}
		>
			<HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={1.5} />
			Approve
		</button>
		<button
			type="button"
			class="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
			onclick={deny}
			aria-label={`Deny mission: ${missionLabel}`}
		>
			<HugeiconsIcon icon={CrossIcon} size={14} strokeWidth={1.5} />
			Deny
		</button>
	</div>
</article>
