<script lang="ts">
	// Approval panel (Svelte 5)
	//
	// Floating side panel that surfaces pending tool-call approval requests
	// coming from the daemon. Appears only when there are pending requests;
	// otherwise the DOM is clean.
	//
	// Interaction model:
	//   • Risk badge makes the consequence scannable at a glance.
	//   • Approve / Deny buttons resolve the request immediately.
	//   • Arg preview is collapsible per request to avoid wall-of-text for
	//     long tool payloads.
	//
	// The store owns the WebSocket lifecycle; this component is a pure view.

	import { approvalsStore } from '$lib/stores/approvals.svelte.js';
	import type { ApprovalRequest } from '$lib/daemon/approvals.js';
	import {
		HugeiconsIcon,
		WarningIcon,
		CheckIcon,
		CrossIcon,
	} from '$lib/icons/index.js';

	const RISK_BADGE: Record<ApprovalRequest['risk'], string> = {
		low: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
		medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
		high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
	};

	const RISK_LABEL: Record<ApprovalRequest['risk'], string> = {
		low: 'Low risk',
		medium: 'Medium risk',
		high: 'High risk',
	};

	let expandedIds = $state<Set<string>>(new Set());

	function toggleExpanded(id: string): void {
		const next = new Set(expandedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedIds = next;
	}

	function formatArgs(args: Record<string, unknown>): string {
		try {
			return JSON.stringify(args, null, 2);
		} catch {
			return String(args);
		}
	}

	function handleApprove(requestId: string): void {
		approvalsStore.respond(requestId, true);
	}

	function handleDeny(requestId: string): void {
		approvalsStore.respond(requestId, false, 'user denied');
	}

	const pending = $derived(approvalsStore.pending);
</script>

{#if pending.length > 0}
	<aside
		class="approval-panel fixed z-50 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
		role="region"
		aria-label="Tool approval requests"
	>
		<header class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
			<h2 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
				<span class="inline-flex items-center justify-center" aria-hidden="true">
					<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
				</span>
				Approval Required
			</h2>
			<span
				class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
				aria-label={`${pending.length} pending request${pending.length === 1 ? '' : 's'}`}
			>
				{pending.length}
			</span>
		</header>

		<ul class="approval-list space-y-2 overflow-y-auto p-3">
			{#each pending as req (req.requestId)}
				{@const isExpanded = expandedIds.has(req.requestId)}
				{@const hasArgs = Object.keys(req.args).length > 0}
				<li class="rounded-md border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/50">
					<div class="mb-2 flex items-center gap-2">
						<span class="truncate font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
							{req.tool}
						</span>
						<span
							class={`rounded-full px-2 py-0.5 text-xs font-medium ${RISK_BADGE[req.risk]}`}
							aria-label={RISK_LABEL[req.risk]}
						>
							{req.risk}
						</span>
					</div>

					{#if hasArgs}
						<button
							type="button"
							class="approval-args-toggle mb-2 text-xs text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:underline dark:text-gray-400 dark:hover:text-gray-200"
							onclick={() => toggleExpanded(req.requestId)}
							aria-expanded={isExpanded}
							aria-controls={`args-${req.requestId}`}
						>
							{isExpanded ? 'Hide' : 'Show'} arguments
						</button>
						{#if isExpanded}
							<pre
								id={`args-${req.requestId}`}
								class="approval-args-pre mb-2 overflow-auto rounded bg-white p-2 font-mono text-xs text-gray-800 dark:bg-gray-950 dark:text-gray-200"
							>{formatArgs(req.args)}</pre>
						{/if}
					{/if}

					<div class="approval-actions flex gap-2">
						<button
							type="button"
							class="approval-btn approval-btn-approve flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
							onclick={() => handleApprove(req.requestId)}
						>
							<span class="inline-flex items-center" aria-hidden="true">
								<HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={1.5} />
							</span>
							Approve
						</button>
						<button
							type="button"
							class="approval-btn approval-btn-deny flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
							onclick={() => handleDeny(req.requestId)}
						>
							<span class="inline-flex items-center" aria-hidden="true">
								<HugeiconsIcon icon={CrossIcon} size={14} strokeWidth={1.5} />
							</span>
							Deny
						</button>
					</div>
				</li>
			{/each}
		</ul>
	</aside>
{/if}

<style>
	/*
	 * Desktop / wide-viewport: floating card pinned to the bottom-right
	 * corner. 24rem (384px) wide, capped to viewport on narrow desktops.
	 * Identical to the previous Tailwind classes (`bottom-4 right-4 w-96
	 * max-w-[calc(100vw-2rem)]`) — moving to global CSS so the mobile
	 * variant below can be exercised by integration tests that probe the
	 * rule via a synthetic node. `:global` is safe here because the
	 * `.approval-panel` class only appears on this single component.
	 */
	:global(.approval-panel) {
		bottom: 1rem;
		right: 1rem;
		left: auto;
		width: 24rem;
		max-width: calc(100vw - 2rem);
	}

	:global(.approval-list) {
		max-height: 60vh;
	}

	:global(.approval-args-pre) {
		max-height: 8rem;
	}

	/*
	 * Mobile (≤640px): the floating card collides with the fixed bottom
	 * navigation (--bottom-nav-height) and the iOS home indicator inset.
	 * Convert to a full-width bottom sheet anchored above the bottom nav,
	 * with rounded top corners and a generous max-height that uses the
	 * dynamic viewport (dvh) so iOS URL-bar collapse doesn't cause
	 * clipping. Buttons get a 48px hit area; the args preview scrolls
	 * vertically and never horizontally.
	 *
	 * Spec MH8 acceptance: the approval panel must work as a mobile-
	 * friendly modal/sheet that doesn't get hidden behind the bottom nav.
	 */
	@media (max-width: 640px) {
		:global(.approval-panel) {
			bottom: var(--bottom-nav-height, 0px);
			right: 0;
			left: 0;
			width: 100%;
			max-width: 100vw;
			border-radius: var(--radius-lg, 12px) var(--radius-lg, 12px) 0 0;
			border-left: none;
			border-right: none;
			border-bottom: none;
			max-height: 70dvh;
			display: flex;
			flex-direction: column;
		}

		:global(.approval-list) {
			max-height: none;
			flex: 1 1 auto;
			min-height: 0;
		}

		:global(.approval-args-pre) {
			/* Allow more vertical room for arg previews on mobile (the
			   sheet itself caps overall height) and keep horizontal
			   overflow scrollable so wrapped JSON paths don't push the
			   sheet sideways. */
			max-height: 12rem;
			overflow-y: auto;
			overflow-x: auto;
			word-break: break-all;
		}

		/* Bigger, thumb-reachable Approve / Deny buttons. The Tailwind
		   utility `py-1.5` resolves to ~32px tall — well below the 48px
		   recommended floor for primary destructive/confirm actions on
		   touch. */
		:global(.approval-btn) {
			min-height: 48px;
			font-size: var(--font-size-sm, 0.875rem);
		}
	}
</style>
