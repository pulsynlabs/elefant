<script lang="ts">
	import { chatStore } from './chat.svelte.js';
	import MessageList, { type GhostEntry } from './MessageList.svelte';
	import MessageInput from './MessageInput.svelte';
	import ProviderSelector from './ProviderSelector.svelte';
	import ConnectionBanner from './ConnectionBanner.svelte';
	import RedoBanner from './RedoBanner.svelte';
	import { getDaemonClient } from '$lib/daemon/client.js';
	import type { MessageRole } from '$lib/daemon/types.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';

	let abortController: AbortController | null = null;

	// Ephemeral "tombstone" entries for pairs that were just undone. Owned
	// here (NOT on chatStore) because ghosts are a purely presentational
	// concern — `chatStore.undo()` already mutates `messages` and the
	// `redoStack`, while the ghost is a fading visual cue layered on top.
	// New entries push to the end; each carries a stable id so multiple
	// stacked ghosts dissolve independently.
	let ghostEntries = $state<GhostEntry[]>([]);

	// Helper that turns the prompt text returned by `chatStore.undo()` into
	// a fresh ghost entry. Centralised so the `/undo` slash intercept and
	// the per-message undo button stay in sync — both surfaces should
	// render exactly the same tombstone for the same kind of action.
	function pushGhost(userContent: string): void {
		if (!userContent) return;
		ghostEntries = [...ghostEntries, { id: crypto.randomUUID(), userContent }];
	}

	function handleGhostRedo(id: string): void {
		chatStore.redo();
		ghostEntries = ghostEntries.filter((g) => g.id !== id);
	}

	function handleGhostDismiss(id: string): void {
		ghostEntries = ghostEntries.filter((g) => g.id !== id);
	}

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

	async function handleSend(content: string): Promise<void> {
		// Client-side slash command intercepts. These commands operate on
		// in-memory chat state only and must NEVER reach the daemon — even
		// when they're a no-op (no pair to undo, empty redo stack), we
		// always early-return so the slash literal isn't streamed as a
		// user prompt. Match is exact trimmed equality so genuine messages
		// like "/undo something I wrote" still forward as normal text.
		const trimmed = content.trim();
		if (trimmed === '/undo') {
			const promptText = chatStore.undo();
			pendingInputRestore = promptText ?? '';
			if (promptText !== null) pushGhost(promptText);
			return;
		}
		if (trimmed === '/redo') {
			chatStore.redo();
			return;
		}

		if (chatStore.isStreaming || !content.trim()) return;

		// A real send invalidates every pending tombstone: the redo stack
		// is cleared inside `addUserMessage`, so any ghost still on screen
		// would point at history the user can no longer reach. Mirror that
		// store-side reset here in lock-step.
		ghostEntries = [];

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
	// Holds the prompt text returned by `chatStore.undo()` so the
	// input component can restore it programmatically. Reset to '' on
	// each send so stale text can never survive across messages.
	let pendingInputRestore = $state('');

	// Per-message undo handler invoked by the inline button rendered on
	// the most recent user message bubble. Mirrors the `/undo` slash
	// command path exactly: call `chatStore.undo()`, then route the
	// returned prompt text into the input via `pendingInputRestore`.
	// Keeping a single restore handshake means the input-side `$effect`
	// stays the only consumer, regardless of which surface triggered
	// the undo.
	function handleUndoMessage(): void {
		const promptText = chatStore.undo();
		pendingInputRestore = promptText ?? '';
		// Mirror the `/undo` slash command path: surface a ghost tombstone
		// for the just-removed pair so the user can redo it inline.
		if (promptText !== null) pushGhost(promptText);
	}

	// Keyboard-shortcut handlers (Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z, plus
	// Ctrl+Y for Windows redo convention). UnifiedChatInput only fires
	// these when its textarea is empty, so by the time we get here the
	// user has clearly signalled intent to undo a chat turn rather than
	// scrub through their typing. Both handlers route through exactly
	// the same code paths as `/undo` / `/redo` and the per-message undo
	// button — single source of truth for what an "undo" or "redo"
	// means at the UI layer.
	function handleUndoShortcut(): void {
		const promptText = chatStore.undo();
		pendingInputRestore = promptText ?? '';
		if (promptText !== null) pushGhost(promptText);
	}

	function handleRedoShortcut(): void {
		chatStore.redo();
	}

	// --- Layout state ---------------------------------------------------
	//
	// The view picks one of two arrangements based on whether the
	// conversation has any messages yet. We swap the entire branch via
	// `{#if hasMessages}` so layout differences (centred vs bottom-pinned)
	// don't fight each other inside a single grid.
	const hasMessages = $derived(chatStore.messages.length > 0);
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
		<MessageList
			messages={chatStore.messages}
			onUndoMessage={handleUndoMessage}
			{ghostEntries}
			onGhostRedo={handleGhostRedo}
			onGhostDismiss={handleGhostDismiss}
		/>
	</div>

	<!-- Input area -->
	<div class="chat-input-area">
		<!--
			Redo availability banner. Sits between the message list and
			the composer so the redo affordance is visible without
			blocking the message stream. Slide transition (inside
			RedoBanner) handles the height collapse so the input doesn't
			visually jump when the banner appears/disappears.
		-->
		{#if chatStore.canRedo}
			<RedoBanner
				redoCount={chatStore.redoCount}
				onRedo={() => chatStore.redo()}
			/>
		{/if}

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
