<script lang="ts">
	import { chatStore } from './chat.svelte.js';
	import MessageList from './MessageList.svelte';
	import MessageInput from './MessageInput.svelte';
	import ProviderSelector from './ProviderSelector.svelte';
	import AdvancedOptions from './AdvancedOptions.svelte';
	import ConnectionBanner from './ConnectionBanner.svelte';
	import AgentOverrideDialog from '../agent-config/AgentOverrideDialog.svelte';
	import { getDaemonClient } from '$lib/daemon/client.js';
	import type { MessageRole } from '$lib/daemon/types.js';
	import type { AgentRunOverride } from '$lib/types/agent-config.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';

	let showAdvanced = $state(false);
	let showOverrideDialog = $state(false);
	let abortController: AbortController | null = null;

	// Subscribe to the active project's SSE event stream so the
	// agent-runs store receives `agent_run.spawned` and
	// `agent_run.tool_call_metadata` envelopes for child runs the
	// assistant spawns via the `task` tool. Without this, TaskToolCard's
	// title-match resolver never finds the child runId and the card is
	// stuck showing "Starting…" forever.
	//
	// `subscribeToProject` is idempotent for the same projectId and
	// internally tears down the previous subscription when projectId
	// changes, so this effect is safe to re-run on every projectId
	// change. We deliberately do NOT call `unsubscribe` on cleanup —
	// the project SSE stream is shared with the agent-runs views, and
	// the store owns its lifecycle.
	$effect(() => {
		const projectId = projectsStore.activeProjectId;
		if (!projectId) return;
		agentRunsStore.subscribeToProject(projectId);
	});

	// Clear the in-memory message list whenever the active session changes so
	// the user always sees a clean slate for the session they just switched to.
	// Use a local tracker to avoid clearing on the initial mount.
	let _lastSessionId = $state<string | null>(projectsStore.activeSessionId);
	$effect(() => {
		const current = projectsStore.activeSessionId;
		const currentProjectId = projectsStore.activeProjectId;

		if (current !== _lastSessionId) {
			_lastSessionId = current;

			// Track the active session so finalizeMessage knows where to persist.
			chatStore.setActiveSession(current);

			// Stop any in-flight stream before clearing
			if (abortController) {
				abortController.abort();
				abortController = null;
			}
			chatStore.clearConversation();

			// Load session history if we have a valid session+project.
			// `$effect` cannot be async in Svelte 5 (effects must be
			// synchronous), so we fire-and-forget the fetch with `void`
			// and use `.then()` to apply a stale-result guard: if the
			// user switches sessions while the fetch is in flight, the
			// resolved messages are discarded so the UI stays consistent
			// with `projectsStore.activeSessionId`.
			if (current !== null && currentProjectId !== null) {
				const requestedSessionId = current;
				const requestedProjectId = currentProjectId;

				void chatStore
					.loadSessionHistory(requestedProjectId, requestedSessionId)
					.then(() => {
						// Race-safety: discard result if user switched sessions mid-fetch
						if (projectsStore.activeSessionId !== requestedSessionId) {
							chatStore.clearConversation();
						}
					});
			}
		}
	});

	function openOverride(): void {
		showOverrideDialog = true;
	}

	function closeOverride(): void {
		showOverrideDialog = false;
	}

	function applyOverride(next: AgentRunOverride): void {
		chatStore.setAgentOverride(next);
		showOverrideDialog = false;
	}

	async function handleSend(content: string): Promise<void> {
		if (chatStore.isStreaming || !content.trim()) return;

		// Add user message to conversation
		chatStore.addUserMessage(content.trim());

		// Build API messages from conversation history (user messages only, before the assistant placeholder)
		const apiMessages: MessageRole[] = chatStore.getApiMessages().map((m) => ({
			role: m.role as MessageRole['role'],
			content: m.content,
		}));

		// Start assistant message placeholder
		chatStore.startAssistantMessage();

		abortController = new AbortController();
		const client = getDaemonClient();

		try {
			// Build the request payload through the store helper so the
			// AdvancedOptions fields and any per-run AgentOverrideDialog
			// override flow through a single, testable code path.
		const fields = chatStore.buildChatRequestFields(projectsStore.activeSessionId, projectsStore.activeProjectId);
		const stream = client.streamChat(
			{ messages: apiMessages, ...fields },
				abortController.signal,
			);

			for await (const event of stream) {
				if (event.type === 'token') {
					chatStore.appendToken(event.text);
				} else if (event.type === 'tool_call') {
					// Early announcement — name + id, arguments may be empty.
					// The card renders immediately and shows a spinner.
					chatStore.addToolCall({
						id: event.id,
						name: event.name,
						arguments: event.arguments,
					});
				} else if (event.type === 'tool_call_update') {
					// Arguments are now fully streamed — patch the existing card
					// so TaskToolCard (and others) can render their full state.
					chatStore.updateToolCallArguments(event.id, event.arguments);
				} else if (event.type === 'tool_call_metadata') {
					// Daemon-supplied runId/title/agentType for a just-spawned
					// child run. TaskToolCard reads `metadata.runId` to resolve
					// its child deterministically — no title-match needed.
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

	function handleStop(): void {
		abortController?.abort();
		chatStore.finalizeMessage('stop');
		abortController = null;
	}
</script>

<div class="chat-view">
	<!-- Connection status banner -->
	<ConnectionBanner />

	<!-- Header with provider selector -->
	<div class="chat-header">
		<h2 class="chat-title industrial-caps">Chat</h2>
		<ProviderSelector />
	</div>

	<!-- Message list (scrollable area) -->
	<div class="chat-messages">
		<MessageList messages={chatStore.messages} />
	</div>

	<!-- Advanced options (collapsible) -->
	{#if showAdvanced}
		<div class="advanced-section glass-sm">
			<AdvancedOptions />
		</div>
	{/if}

	<!-- Input area -->
	<div class="chat-input-area">
		<div class="composer-actions">
			<button
				class="advanced-toggle mono-label"
				onclick={() => (showAdvanced = !showAdvanced)}
				aria-label="Toggle advanced options"
				aria-expanded={showAdvanced}
			>
				{showAdvanced ? '▲' : '▼'} Options
			</button>
			<button
				type="button"
				class="override-toggle mono-label"
				class:override-toggle-active={chatStore.hasAgentOverride}
				onclick={openOverride}
				aria-label="Open per-run override dialog"
				aria-haspopup="dialog"
			>
				Override{chatStore.hasAgentOverride ? ' ●' : ''}
			</button>
		</div>
		<MessageInput
			disabled={chatStore.isStreaming}
			streaming={chatStore.isStreaming}
			onSend={handleSend}
			onStop={handleStop}
		/>
	</div>
</div>

{#if showOverrideDialog}
	<AgentOverrideDialog
		initialOverride={chatStore.getAgentOverride()}
		availableProviders={chatStore.availableProviders}
		onConfirm={applyOverride}
		onCancel={closeOverride}
	/>
{/if}

<style>
	.chat-view {
		display: grid;
		grid-template-rows: auto 1fr auto auto;
		height: 100%;
		overflow: hidden;
		background-color: var(--color-bg);
	}

	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-surface);
		flex-shrink: 0;
	}

	.chat-title {
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
		margin: 0;
	}

	.chat-messages {
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.advanced-section {
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--color-border);
		margin: 0 var(--space-3);
		border-radius: var(--radius-md);
	}

	.chat-input-area {
		padding: var(--space-3) var(--space-5) var(--space-5);
		border-top: 1px solid var(--color-border);
		background-color: var(--color-surface);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.composer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.advanced-toggle,
	.override-toggle {
		background: none;
		border: 1px solid transparent;
		cursor: pointer;
		color: var(--color-text-muted);
		text-align: left;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.advanced-toggle:hover,
	.override-toggle:hover {
		color: var(--color-text-secondary);
	}

	.advanced-toggle:focus-visible,
	.override-toggle:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.override-toggle-active {
		color: var(--color-warning, #b88400);
		border-color: color-mix(
			in srgb,
			var(--color-warning, #b88400) 40%,
			transparent
		);
		background-color: color-mix(
			in srgb,
			var(--color-warning, #b88400) 10%,
			transparent
		);
	}
</style>
