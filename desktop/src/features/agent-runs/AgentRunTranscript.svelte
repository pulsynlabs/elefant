<script lang="ts">
	// AgentRunTranscript — renders the active run's transcript.
	//
	// Token events are coalesced into streaming-message-style text bubbles
	// (so Shiki-highlighted code fences in the existing StreamingMessage
	// path keep working). Tool calls reuse ToolCallCard. Terminal events
	// (done/error/cancelled) render a status banner at the tail.

	import { DAEMON_URL } from '$lib/daemon/client.js';
	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import type {
		AgentRun,
		AgentRunStatus,
		AgentRunTranscriptEntry,
		DaemonResult,
	} from '$lib/types/agent-run.js';
	import StreamingMessage from '../chat/StreamingMessage.svelte';
	import ToolCallCard from '../chat/ToolCallCard.svelte';
	import AgentTaskCard from './AgentTaskCard.svelte';
	import { computeRenderBlocks } from './agent-run-transcript-blocks.js';
	import {
		mapApiMessagesToEntries,
		mergeHistoricalAndLive,
		type AgentRunMessagesResponse,
	} from './agent-run-transcript-history.js';

	type Props = {
		runId?: string;
	};

	let { runId }: Props = $props();

	const effectiveRunId = $derived(runId ?? agentRunsStore.activeRunId);

	const run = $derived<AgentRun | null>(
		effectiveRunId ? agentRunsStore.runs[effectiveRunId] ?? null : null,
	);

	// projectId is required to hit the per-project messages endpoint.
	// We pull it off the run row in the store rather than threading
	// another prop down from ChildRunView (the brief explicitly forbids
	// modifying ChildRunView). Until the run row hydrates, projectId
	// is null and the historical fetch effect is skipped.
	const projectId = $derived<string | null>(run?.projectId ?? null);

	// Live SSE entries — same source as before; the merge logic below
	// keeps the contract that this component reads from the store and
	// never writes back into it.
	const liveEntries = $derived<AgentRunTranscriptEntry[]>(
		effectiveRunId ? agentRunsStore.transcripts[effectiveRunId] ?? [] : [],
	);

	// Historical messages loaded from the REST endpoint on mount.
	// Resets whenever `effectiveRunId` changes so navigating between
	// child runs in ChildRunView re-fetches cleanly.
	let historical = $state<AgentRunTranscriptEntry[]>([]);
	let historicalLoaded = $state(false);
	// Snapshot of `liveEntries.length` at the instant the fetch
	// resolved. Anything past this index in `liveEntries` is treated as
	// genuinely new (arrived after the daemon persisted what historical
	// covered) and is appended to the historical list. See
	// mergeHistoricalAndLive for the rationale on why we use an index
	// snapshot rather than a cross-source seq comparison.
	let liveBaselineLength = $state(0);

	$effect(() => {
		// Re-run on runId or projectId change. Reset state inline so a
		// switch from one child run to another doesn't flash stale
		// historical content.
		const currentRunId = effectiveRunId;
		const currentProjectId = projectId;
		historical = [];
		historicalLoaded = false;
		liveBaselineLength = 0;

		if (!currentRunId || !currentProjectId) return;

		// Capture the runId we fetched FOR so a fast switch to a
		// different run doesn't apply stale history once the original
		// fetch resolves (Svelte $effect cleanup would also work, but
		// AbortController + identity check keeps it transport-agnostic).
		const ac = new AbortController();
		const fetchedRunId = currentRunId;
		const fetchedProjectId = currentProjectId;

		void fetch(
			`${DAEMON_URL}/api/projects/${encodeURIComponent(fetchedProjectId)}/runs/${encodeURIComponent(fetchedRunId)}/messages`,
			{
				signal: ac.signal,
				headers: { Accept: 'application/json' },
			},
		)
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				return (await response.json()) as DaemonResult<AgentRunMessagesResponse>;
			})
			.then((parsed) => {
				// Stale fetch — the user already navigated away.
				if (effectiveRunId !== fetchedRunId) return;
				if (!parsed.ok) {
					// Daemon replied with ok=false — record that the load
					// finished so the renderer stops waiting, but leave
					// historical empty so the live stream is the only source.
					historicalLoaded = true;
					liveBaselineLength = liveEntries.length;
					return;
				}
				historical = mapApiMessagesToEntries(parsed.data.messages);
				liveBaselineLength = liveEntries.length;
				historicalLoaded = true;
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				// Fail open: keep the live SSE flow responsive even when
				// the historical endpoint is unreachable. The transcript
				// degrades to "live-only" — same behavior the component
				// shipped with before MH5.
				if (effectiveRunId !== fetchedRunId) return;
				historicalLoaded = true;
				liveBaselineLength = liveEntries.length;
			});

		return () => {
			ac.abort();
		};
	});

	const entries = $derived<AgentRunTranscriptEntry[]>(
		mergeHistoricalAndLive({
			historical,
			live: liveEntries,
			liveBaselineLength,
			historicalLoaded,
		}),
	);

	// Direct children of the active run. Used as the fallback source for
	// task block runId resolution: when a `task` tool_call has no
	// metadata.runId yet, we match by title against these children.
	// Derived off the store so resolution updates reactively whenever
	// `agent_run.spawned` lands a new child.
	const childRuns = $derived(
		effectiveRunId ? agentRunsStore.childRunsForRun(effectiveRunId) : [],
	);

	const renderBlocks = $derived(
		computeRenderBlocks(entries, { childRuns }),
	);

	/**
	 * Open a child run spawned via the `task` tool.
	 *
	 * Wired through navigationStore to push a child-run view onto the nav stack.
	 */
	function openChildRun(childRunId: string): void {
		navigationStore.openChildRun(childRunId);
	}

	function terminalHeading(status: AgentRunStatus): string {
		switch (status) {
			case 'done':
				return 'Run complete';
			case 'error':
				return 'Run failed';
			case 'cancelled':
				return 'Run cancelled';
			default:
				return 'Run ended';
		}
	}
</script>

{#if !effectiveRunId}
	<div class="empty" role="status">Select a run to view its transcript.</div>
{:else if !run}
	<div class="empty" role="status">Loading run…</div>
{:else}
	<article
		id="agent-run-panel-{effectiveRunId}"
		class="transcript"
		role="tabpanel"
		aria-label="Transcript for {run.title}"
	>
		<header class="transcript-header">
			<div class="meta">
				<span class="agent-badge">{run.agentType}</span>
				<h2 class="title">{run.title}</h2>
			</div>
			<span class="status status-{run.status}">
				{run.status}
			</span>
		</header>

		{#if renderBlocks.length === 0}
			<div class="empty" role="status">
				{run.status === 'running'
					? 'Waiting for first output…'
					: 'This run produced no transcript output.'}
			</div>
		{:else}
			<ol class="blocks">
				{#each renderBlocks as block (block.id)}
					<li class="block">
						{#if block.kind === 'text'}
							<StreamingMessage message={block.message} />
						{:else if block.kind === 'tool'}
							<ToolCallCard toolCall={block.toolCall} />
						{:else if block.kind === 'task'}
							<AgentTaskCard
								title={block.title}
								agentType={block.agentType}
								toolCallId={block.toolCallId}
								parentRunId={effectiveRunId ?? ''}
								resolvedRunId={block.resolvedRunId}
								onOpenChildRun={openChildRun}
							/>
						{:else if block.kind === 'question'}
							<div class="question-card" role="region" aria-label="Agent question">
								<h3 class="question-heading">Question</h3>
								<p class="question-body">{block.question}</p>
								{#if block.options.length > 0}
									<ul class="question-options">
										{#each block.options as option, i (i)}
											<li class="question-option">
												<strong>{option.label}</strong>
												{#if option.description}
													<span class="question-desc"> — {option.description}</span>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
								<p class="question-hint">
									Answering from the transcript is not yet supported; watch
									the chat composer for v1.
								</p>
							</div>
						{:else if block.kind === 'terminal'}
							<div
								class="terminal terminal-{block.status}"
								role="status"
								aria-live="polite"
							>
								<strong>{terminalHeading(block.status)}.</strong>
								<span>{block.message}</span>
							</div>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</article>
{/if}

<style>
	.transcript {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-4);
		max-width: 900px;
		margin: 0 auto;
		width: 100%;
	}

	.transcript-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.agent-badge {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background-color: var(--color-surface);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		text-transform: lowercase;
		flex-shrink: 0;
	}

	.title {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.status-running {
		color: var(--color-primary);
		background-color: color-mix(
			in srgb,
			var(--color-primary, #3b82f6) 12%,
			transparent
		);
	}

	.status-done {
		color: var(--color-success, #10b981);
		background-color: color-mix(
			in srgb,
			var(--color-success, #10b981) 12%,
			transparent
		);
	}

	.status-error {
		color: var(--color-error);
		background-color: color-mix(
			in srgb,
			var(--color-error, #ef4444) 12%,
			transparent
		);
	}

	.status-cancelled {
		color: var(--color-text-muted);
		background-color: var(--color-surface);
	}

	.blocks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.block {
		display: block;
	}

	.empty {
		padding: var(--space-6);
		text-align: center;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		background-color: var(--color-surface);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
	}

	.question-card {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-warning, #d97706);
		border-radius: var(--radius-md);
		background-color: color-mix(
			in srgb,
			var(--color-warning, #d97706) 8%,
			transparent
		);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.question-heading {
		margin: 0;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--color-warning, #d97706);
	}

	.question-body {
		margin: 0;
		font-size: var(--font-size-md);
		color: var(--color-text-primary);
	}

	.question-options {
		margin: 0;
		padding-left: var(--space-5);
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		line-height: var(--line-height-relaxed);
	}

	.question-option {
		padding: 2px 0;
	}

	.question-desc {
		color: var(--color-text-muted);
	}

	.question-hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.terminal {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background-color: var(--color-surface);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}

	.terminal-done {
		border-color: color-mix(in srgb, var(--color-success, #10b981) 45%, transparent);
		color: var(--color-text-primary);
	}

	.terminal-error {
		border-color: var(--color-error);
		color: var(--color-text-primary);
		background-color: color-mix(in srgb, var(--color-error) 8%, transparent);
	}

	.terminal-cancelled {
		border-color: var(--color-border-strong);
		color: var(--color-text-muted);
	}

	@media (max-width: 640px) {
		.transcript {
			padding: var(--space-4) var(--space-3);
		}
	}
</style>
