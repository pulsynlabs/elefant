<script lang="ts">
	// AgentRunTranscript — renders the active run's transcript.
	//
	// Token events are coalesced into streaming-message-style text bubbles
	// (so Shiki-highlighted code fences in the existing StreamingMessage
	// path keep working). Tool calls reuse ToolCallCard. Terminal events
	// (done/error/cancelled) render a status banner at the tail.

	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import type {
		AgentRun,
		AgentRunStatus,
		AgentRunTranscriptEntry,
	} from '$lib/types/agent-run.js';
	import type {
		ChatMessage,
		ContentBlock,
		ToolCallDisplay,
	} from '../chat/types.js';
	import StreamingMessage from '../chat/StreamingMessage.svelte';
	import ToolCallCard from '../chat/ToolCallCard.svelte';

	type Props = {
		runId?: string;
	};

	let { runId }: Props = $props();

	const effectiveRunId = $derived(runId ?? agentRunsStore.activeRunId);

	const run = $derived<AgentRun | null>(
		effectiveRunId ? agentRunsStore.runs[effectiveRunId] ?? null : null,
	);

	const entries = $derived<AgentRunTranscriptEntry[]>(
		effectiveRunId ? agentRunsStore.transcripts[effectiveRunId] ?? [] : [],
	);

	/**
	 * Group transcript entries into chunks the UI can render:
	 *   - consecutive `token` events fold into a single streaming
	 *     assistant message (so fenced code still works)
	 *   - `tool_call` / `tool_result` pair up into a ToolCallDisplay
	 *   - `question` and `terminal` become their own blocks
	 */
	type RenderBlock =
		| { kind: 'text'; id: string; message: ChatMessage }
		| { kind: 'tool'; id: string; toolCall: ToolCallDisplay }
		| {
				kind: 'question';
				id: string;
				question: string;
				options: Array<{ label: string; description?: string }>;
				multiple: boolean;
		  }
		| { kind: 'terminal'; id: string; status: AgentRunStatus; message: string };

	const renderBlocks = $derived<RenderBlock[]>(computeRenderBlocks(entries));

	function computeRenderBlocks(source: AgentRunTranscriptEntry[]): RenderBlock[] {
		const out: RenderBlock[] = [];
		const toolCallsById = new Map<string, ToolCallDisplay>();
		let currentText: { id: string; text: string } | null = null;

		const flushText = (): void => {
			if (!currentText) return;
			const blocks: ContentBlock[] = [{ type: 'text', text: currentText.text }];
			const message: ChatMessage = {
				id: currentText.id,
				role: 'assistant',
				content: currentText.text,
				blocks,
				timestamp: new Date(),
			};
			out.push({ kind: 'text', id: currentText.id, message });
			currentText = null;
		};

		for (const entry of source) {
			switch (entry.kind) {
				case 'token': {
					if (!currentText) {
						currentText = { id: `text-${entry.seq}`, text: entry.text };
					} else {
						currentText.text += entry.text;
					}
					break;
				}
				case 'tool_call': {
					flushText();
					const display: ToolCallDisplay = {
						id: entry.id,
						name: entry.name,
						arguments: entry.arguments,
					};
					toolCallsById.set(entry.id, display);
					out.push({ kind: 'tool', id: `tool-${entry.id}`, toolCall: display });
					break;
				}
				case 'tool_result': {
					const existing = toolCallsById.get(entry.toolCallId);
					if (existing) {
						existing.result = {
							toolCallId: entry.toolCallId,
							content: entry.content,
							isError: entry.isError,
						};
					}
					break;
				}
				case 'question': {
					flushText();
					out.push({
						kind: 'question',
						id: `q-${entry.questionId}-${entry.seq}`,
						question: entry.question,
						options: entry.options,
						multiple: entry.multiple,
					});
					break;
				}
				case 'terminal': {
					flushText();
					out.push({
						kind: 'terminal',
						id: `terminal-${entry.seq}`,
						status: entry.status,
						message: entry.message,
					});
					break;
				}
			}
		}

		flushText();
		return out;
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
