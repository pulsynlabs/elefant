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
  - Mounts UnifiedChatInput at the bottom of the workflow chrome and wires
    its send/stop handlers to the daemon streaming API exactly the same way
    ChatView does — so a Spec Mode session feels identical to Quick Mode at
    the streaming level (REQ-010 parity).

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
	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import { DAEMON_URL, getDaemonClient } from '$lib/daemon/client.js';
	import type { MessageRole } from '$lib/daemon/types.js';
	import WorkflowSwitcher from './WorkflowSwitcher.svelte';
	import PhaseRail from './PhaseRail.svelte';
	import SpecViewer from './SpecViewer.svelte';
	import WaveTaskBoard from './WaveTaskBoard.svelte';
	import SpecVisionPane from './SpecVisionPane.svelte';
	import { optimizePrompt } from './optimize-prompt.js';
	import UnifiedChatInput from '../chat/UnifiedChatInput.svelte';
	import { chatStore } from '../chat/chat.svelte.js';
	import { HugeiconsIcon, WarningIcon, InfoIcon } from '$lib/icons/index.js';

	type View = 'spec' | 'tasks';

	let activeView = $state<View>('spec');
	let unsubscribe: (() => void) | null = null;
	let legacyMode = $state(false);
	let optimizing = $state(false);

	// Mirrors ChatView.svelte: drives `handleSpecStop` and is reset on every
	// new send / abort. Kept module-scoped to the component so the abort
	// signal survives across the async streaming loop.
	let abortController: AbortController | null = null;

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

	// Subscribe to the active project's SSE stream so the agent-runs store
	// receives `agent_run.spawned` and `agent_run.tool_call_metadata`
	// envelopes for child runs the assistant spawns via the `task` tool.
	// Identical to ChatView.svelte — `subscribeToProject` is idempotent for
	// the same projectId and tears down the previous subscription internally
	// when projectId changes, so we deliberately do NOT call its return
	// here on cleanup. The store owns the lifecycle.
	$effect(() => {
		const pid = projectId;
		if (!pid) return;
		agentRunsStore.subscribeToProject(pid);
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

	/**
	 * Stream a user message through the daemon — mirrors ChatView.handleSend.
	 *
	 * The Spec Mode chat surface shares chatStore with Quick Mode by design:
	 * a spec session is just a chat session that happens to be associated
	 * with a workflow, and at the streaming level the two are identical
	 * (REQ-010). We use the same buildChatRequestFields helper so any
	 * AdvancedOptions / per-run agent overrides flow through one code path.
	 */
	async function handleSpecSend(content: string): Promise<void> {
		if (chatStore.isStreaming || !content.trim()) return;

		chatStore.addUserMessage(content.trim());

		const apiMessages: MessageRole[] = chatStore.getApiMessages().map((m) => ({
			role: m.role as MessageRole['role'],
			content: m.content,
		}));

		chatStore.startAssistantMessage();

		abortController = new AbortController();
		const client = getDaemonClient();

		try {
			const fields = chatStore.buildChatRequestFields(
				projectsStore.activeSessionId,
				projectsStore.activeProjectId,
			);
			const stream = client.streamChat(
				{ messages: apiMessages, ...fields },
				abortController.signal,
			);

			for await (const event of stream) {
				if (event.type === 'token') {
					chatStore.appendToken(event.text);
				} else if (event.type === 'tool_call') {
					chatStore.addToolCall({
						id: event.id,
						name: event.name,
						arguments: event.arguments,
					});
				} else if (event.type === 'tool_call_update') {
					chatStore.updateToolCallArguments(event.id, event.arguments);
				} else if (event.type === 'tool_call_metadata') {
					chatStore.patchToolCallMetadata(event.toolCallId, {
						runId: event.runId,
						agentType: event.agentType,
						title: event.title,
						parentRunId: event.parentRunId,
					});
				} else if (event.type === 'tool_result') {
					chatStore.addToolResult(event.toolCallId, event.content, event.isError);
				} else if (event.type === 'question') {
					chatStore.addQuestion(event);
				} else if (event.type === 'done') {
					chatStore.finalizeMessage(event.finishReason);
					break;
				} else if (event.type === 'error') {
					chatStore.setStreamingError(`${event.code}: ${event.message}`);
					break;
				}
			}
		} catch (err) {
			if (err instanceof Error && err.name !== 'AbortError') {
				chatStore.setStreamingError(err.message);
			} else {
				chatStore.finalizeMessage('stop');
			}
		} finally {
			abortController = null;
		}
	}

	function handleSpecStop(): void {
		abortController?.abort();
		chatStore.finalizeMessage('stop');
		abortController = null;
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

<div class="spec-mode-view" data-testid="spec-mode-view">
	{#if !projectId}
		<div class="spec-no-project">
			<p>Open a project to view its spec workflows.</p>
		</div>
	{:else if legacyMode}
		<div role="alert" class="spec-legacy-alert">
			<div class="spec-legacy-alert-content">
				<HugeiconsIcon icon={InfoIcon} size={18} strokeWidth={1.5} />
				<div>
					<p class="spec-legacy-alert-title">Legacy mode — Spec Mode disabled</p>
					<p class="spec-legacy-alert-body">
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
			and tab content, plus a UnifiedChatInput pinned to the bottom
			wired to the same daemon streaming pipeline as Quick Mode.
		-->
		<div
			class="spec-chrome"
			in:fade={{ duration: motionDuration(FADE_IN_MS), easing: quintOut }}
		>
			<header class="spec-chrome-header">
				<div class="spec-chrome-header-row">
					<div class="spec-workflow-switcher-wrapper">
						<WorkflowSwitcher {projectId} />
					</div>
					<div
						role="tablist"
						aria-label="Spec mode panel view"
						class="spec-tab-list"
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
								class="spec-tab-btn"
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
				<div role="alert" class="spec-error-banner">
					<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
					<span>{specModeStore.error}</span>
				</div>
			{/if}

			<main class="spec-content-area">
				{#if activeView === 'spec'}
					<div class="spec-content-fill">
						<SpecViewer />
					</div>
				{:else}
					<div class="spec-content-fill">
						<WaveTaskBoard />
					</div>
				{/if}
			</main>

			<!--
				Unified chat input — wired to the daemon streaming pipeline so
				the surface behaves identically to Quick Mode (REQ-010). Send
				/Stop route through the shared chatStore exactly like
				ChatView.handleSend / handleStop.
			-->
			<div class="spec-chat-input">
				<UnifiedChatInput
					disabled={chatStore.isStreaming}
					streaming={chatStore.isStreaming}
					onSend={handleSpecSend}
					onStop={handleSpecStop}
				/>
			</div>
		</div>
	{/if}
</div>

<style>
	/* ----- Outer shell -------------------------------------------------- */
	/*
	 * Fills the panel as a vertical flex column. `gap` provides breathing
	 * room between the chrome header, error banner, content area, and
	 * chat input dock without each child needing its own margin.
	 */
	.spec-mode-view {
		height: 100%;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background-color: var(--surface-substrate);
		padding: var(--space-4);
	}

	/* ----- Empty / legacy states --------------------------------------- */
	.spec-no-project {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.spec-no-project p {
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		color: var(--text-meta);
		margin: 0;
	}

	.spec-legacy-alert {
		border: 1px solid var(--color-warning);
		background-color: var(--surface-leaf);
		border-radius: var(--radius-md);
		padding: var(--space-4) var(--space-5);
		color: var(--color-warning);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
	}

	.spec-legacy-alert-content {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.spec-legacy-alert-title {
		margin: 0;
		font-size: var(--font-size-sm);
		font-weight: 600;
	}

	.spec-legacy-alert-body {
		margin: var(--space-1) 0 0 0;
		font-size: var(--font-size-xs);
		line-height: 1.5;
	}

	.spec-legacy-alert code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background-color: var(--surface-hover);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
	}

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

	/* Error banner shown above the vision pane when createWorkflow fails. */
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
	 * WaveTaskBoard) absorbs the elastic middle.
	 */
	.spec-chrome {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.spec-chrome-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-lg);
		background-color: var(--surface-plate);
		padding: var(--space-3);
		flex-shrink: 0;
	}

	.spec-chrome-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.spec-workflow-switcher-wrapper {
		min-width: 16rem;
		flex: 1;
		max-width: 28rem;
	}

	/* ----- Tab toggle --------------------------------------------------- */
	.spec-tab-list {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: var(--space-1);
		border-radius: var(--radius-md);
		background-color: var(--surface-hover);
		padding: var(--space-1);
	}

	.spec-tab-btn {
		border: none;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 500;
		color: var(--text-meta);
		background: transparent;
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.spec-tab-btn:hover {
		background-color: var(--surface-leaf);
	}

	.spec-tab-btn[aria-selected='true'] {
		background-color: var(--surface-leaf);
		color: var(--color-primary);
		box-shadow: var(--shadow-xs);
	}

	/* ----- Error banner (post-creation) -------------------------------- */
	.spec-error-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-md);
		background-color: var(--surface-leaf);
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		color: var(--color-error);
		flex-shrink: 0;
	}

	/* ----- Content area ------------------------------------------------- */
	.spec-content-area {
		flex: 1;
		min-height: 0;
	}

	.spec-content-fill {
		height: 100%;
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
		.spec-chrome,
		.spec-tab-btn {
			transition: none;
		}
	}
</style>
