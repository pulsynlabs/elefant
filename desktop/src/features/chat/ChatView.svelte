<script lang="ts">
	import { chatStore } from './chat.svelte.js';
	import MessageList from './MessageList.svelte';
	import MessageInput from './MessageInput.svelte';
	import ProviderSelector from './ProviderSelector.svelte';
	import ConnectionBanner from './ConnectionBanner.svelte';
	import { getDaemonClient } from '$lib/daemon/client.js';
	import type { MessageRole } from '$lib/daemon/types.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';

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

	<!-- Input area -->
	<div class="chat-input-area">
		<MessageInput
			disabled={chatStore.isStreaming}
			streaming={chatStore.isStreaming}
			onSend={handleSend}
			onStop={handleStop}
		/>
	</div>
</div>

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

	.chat-input-area {
		padding: var(--space-3) var(--space-5) var(--space-5);
		border-top: 1px solid var(--color-border);
		background-color: var(--color-surface);
		flex-shrink: 0;
	}
</style>
