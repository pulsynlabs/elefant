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
	import { fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { specModeStore } from '$lib/stores/spec-mode.svelte.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { DAEMON_URL } from '$lib/daemon/client.js';
	import WorkflowSwitcher from './WorkflowSwitcher.svelte';
	import PhaseRail from './PhaseRail.svelte';
	import SpecViewer from './SpecViewer.svelte';
	import WaveTaskBoard from './WaveTaskBoard.svelte';
	import SpecVisionPane from './SpecVisionPane.svelte';
	import { optimizePrompt } from './optimize-prompt.js';
	import UnifiedChatInput from '../chat/UnifiedChatInput.svelte';
	import { HugeiconsIcon, WarningIcon, InfoIcon } from '$lib/icons/index.js';

	type View = 'spec' | 'tasks';

	let activeView = $state<View>('spec');
	let unsubscribe: (() => void) | null = null;
	let legacyMode = $state(false);
	let optimizing = $state(false);

	const projectId = $derived(projectsStore.activeProjectId);

	// Whether the user has any workflow visible. We include `loading` so the
	// vision pane doesn't flash on initial mount while the workflow list is
	// still being fetched — that would be jarring if the project already has
	// workflows on disk.
	const hasWorkflow = $derived(
		specModeStore.workflows.length > 0 || specModeStore.loading,
	);

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

	/**
	 * Convert an arbitrary user string into a kebab-case workflow id.
	 *
	 * The daemon only accepts `[a-z0-9-]` for workflow ids; we strip everything
	 * else, collapse whitespace into single dashes, and cap the length to 50
	 * chars so the id stays human-readable. If the entire input gets stripped
	 * (e.g. emoji-only or all punctuation), we fall back to a stable default
	 * rather than letting the daemon reject an empty string.
	 */
	function slugify(text: string): string {
		const slug = text
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '')
			.trim()
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 50);
		return slug.length > 0 ? slug : 'new-workflow';
	}

	/**
	 * Handle the vision-pane submission. If the Prompt Engineer toggle is on
	 * we run the user's text through the client-side optimizer first, then
	 * create a workflow via specModeStore. Errors propagate to
	 * `specModeStore.error` and render via the existing error banner — we
	 * deliberately don't throw here so the pane stays mounted on failure.
	 *
	 * Once `createWorkflow` succeeds, `specModeStore.workflows.length` becomes
	 * non-zero, `hasWorkflow` flips to true, and the view reactively
	 * cross-fades into the workflow chrome below. No imperative routing.
	 */
	async function handleVisionSubmit(text: string, optimize: boolean): Promise<void> {
		if (!projectId) return;

		let finalText = text;
		if (optimize) {
			optimizing = true;
			try {
				finalText = await optimizePrompt(text);
			} finally {
				optimizing = false;
			}
		}

		const workflowId = slugify(finalText.slice(0, 40));
		await specModeStore.createWorkflow(projectId, {
			workflowId,
			mode: 'spec',
		});
		// On success: hasWorkflow flips to true via the $derived above.
		// On failure: specModeStore.error is set and the existing alert
		// banner renders — but only inside the chrome branch. The pane
		// stays put because hasWorkflow is still false.
	}

	// --- Motion ---------------------------------------------------------
	//
	// Mirrors the ChatView pattern: the Svelte `fade` directive is JS-driven
	// so a CSS @media (prefers-reduced-motion: reduce) rule cannot disable
	// it. We inspect the media query at call time and zero the duration
	// when the user has opted out, falling back to `base` everywhere else.
	function motionDuration(base: number): number {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return base;
		}
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : base;
	}

	// Aligned with Quire `--duration-base` (250ms) and `--duration-fast`
	// (150ms): we always exit faster than we enter so the swap feels
	// brisk rather than draggy.
	const FADE_IN_MS = 200;
	const FADE_OUT_MS = 150;
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
	{:else if !hasWorkflow}
		<!--
			===== Vision pane: zero-state for Spec Mode =====
			Shown when the project has no workflows AND the initial load has
			settled. The pane fills the entire panel and is the only thing
			visible — no header, no PhaseRail, no tabs — to give the user a
			focused canvas for describing what they want to build.
		-->
		<section
			class="spec-vision-host"
			in:fade={{ duration: motionDuration(FADE_IN_MS), easing: quintOut }}
			out:fade={{ duration: motionDuration(FADE_OUT_MS), easing: quintOut }}
		>
			{#if specModeStore.error}
				<div role="alert" class="vision-error-banner">
					<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
					<span>{specModeStore.error}</span>
				</div>
			{/if}
			<SpecVisionPane onSubmit={handleVisionSubmit} {optimizing} />
		</section>
	{:else}
		<!--
			===== Workflow chrome: post-vision state =====
			Once a workflow exists we show the existing switcher, phase rail,
			and tab content. The new addition is the UnifiedChatInput pinned
			to the bottom of the panel — a placeholder for now, fully wired
			to the daemon in W5-T1.
		-->
		<div
			class="spec-chrome"
			in:fade={{ duration: motionDuration(FADE_IN_MS), easing: quintOut }}
		>
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
				{#if activeView === 'spec'}
					<div class="h-full">
						<SpecViewer />
					</div>
				{:else}
					<div class="h-full">
						<WaveTaskBoard />
					</div>
				{/if}
			</main>

			<!--
				Unified chat input — placeholder for W5-T1.
				Mounted at the bottom of the workflow chrome so the surface
				is byte-for-byte identical to Quick Mode (REQ-010). Send/Stop
				wiring lands in the W5-T1 task; for now the handlers are
				no-ops so the input renders without crashing.
			-->
			<div class="spec-chat-input">
				<UnifiedChatInput
					disabled={false}
					streaming={false}
					onSend={async (_text) => {
						/* TODO: wire send through daemon in W5-T1 */
					}}
					onStop={() => {
						/* TODO: wire stop through daemon in W5-T1 */
					}}
				/>
			</div>
		</div>
	{/if}
</div>

<style>
	/* ----- Vision pane host -------------------------------------------- */
	/*
	 * The vision pane wants to fill the entire Spec Mode panel and centre
	 * itself. SpecVisionPane already centres its own card; we just need
	 * to give it the full height and let the optional error banner stack
	 * above it without disrupting the centred layout.
	 */
	.spec-vision-host {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.spec-vision-host > :global(.spec-vision-pane) {
		flex: 1;
		min-height: 0;
	}

	/* Error banner shown above the vision pane when createWorkflow fails.
	   Tokenised twin of the legacy Tailwind alert in the chrome branch
	   (which W5-T2 will migrate to match this style). */
	.vision-error-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-md);
		background-color: var(--surface-leaf);
		color: var(--color-error);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		line-height: 1.4;
	}

	/* ----- Workflow chrome --------------------------------------------- */
	/*
	 * Fills the available height as a vertical column so the chat input
	 * can pin to the bottom while the main tab content (SpecViewer /
	 * WaveTaskBoard) absorbs the elastic middle. Spacing matches the
	 * outer Tailwind `gap-3` so the migration in W5-T2 stays visually
	 * lossless.
	 */
	.spec-chrome {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* ----- Chat input dock --------------------------------------------- */
	/*
	 * Bottom-pinned input dock. `flex-shrink: 0` keeps it from being
	 * squeezed by tall task lists; the hairline top border separates it
	 * visually from the content above without competing with the chrome's
	 * own card borders.
	 */
	.spec-chat-input {
		flex-shrink: 0;
		padding: var(--space-3) var(--space-4) var(--space-4);
		border-top: 1px solid var(--border-edge);
	}

	/* ----- Reduced motion ---------------------------------------------- */
	/*
	 * Defensive belt-and-braces. The Svelte `fade` directive is JS-driven
	 * and zeroed via `motionDuration()` at the call site, but disabling
	 * any future CSS-driven transitions in this file keeps the surface
	 * reduced-motion-safe.
	 */
	@media (prefers-reduced-motion: reduce) {
		.spec-vision-host,
		.spec-chrome {
			transition: none;
		}
	}
</style>
