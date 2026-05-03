<script lang="ts">
	/**
	 * ChatView — the Quick Mode chat surface.
	 *
	 * Two visual states, exchanged via cross-fade:
	 *
	 *   1. Zero-state (no messages yet)
	 *      The composer floats centred in the viewport with a serif
	 *      heading above it. This is the "ChatGPT moment" that signals
	 *      the surface is ready and waiting for the first prompt.
	 *
	 *   2. Active state (one or more messages)
	 *      Messages occupy the scrollable area; the composer is
	 *      pinned to the bottom with a constrained max-width for
	 *      reading rhythm.
	 *
	 * The transition is purely CSS / Svelte transitions — no JS-driven
	 * positioning. Durations are routed through Quire motion tokens
	 * (`--duration-base`, `--duration-fast`) so the system stays
	 * consistent and reduced-motion-aware.
	 *
	 * The chat header (title + ProviderSelector) was retired in this
	 * rewrite: model selection now lives inside the unified composer
	 * itself (see `UnifiedChatInput`), so a separate header bar is
	 * redundant and visually noisy.
	 */
	import { chatStore } from './chat.svelte.js';
	import MessageList, { type GhostEntry } from './MessageList.svelte';
	import UnifiedChatInput from './UnifiedChatInput.svelte';
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

	// Reset `pendingInputRestore` after one frame so the $effect in
	// UnifiedChatInput fires exactly once per undo. Called after every
	// path that sets `pendingInputRestore` to a non-empty string.
	function clearPendingRestore(): void {
		requestAnimationFrame(() => { pendingInputRestore = ''; });
	}

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
			if (promptText !== null) {
				pushGhost(promptText);
				clearPendingRestore();
			}
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
	function handleUndoMessage(): void {
		const promptText = chatStore.undo();
		pendingInputRestore = promptText ?? '';
		if (promptText !== null) {
			pushGhost(promptText);
			clearPendingRestore();
		}
	}

	// Keyboard-shortcut handlers (Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z, plus
	// Ctrl+Y for Windows redo convention). UnifiedChatInput only fires
	// these when its textarea is empty, so by the time we get here the
	// user has clearly signalled intent to undo a chat turn rather than
	// scrubbing through their typing. Both handlers route through exactly
	// the same code paths as `/undo` / `/redo` and the per-message undo
	// button — single source of truth.
	function handleUndoShortcut(): void {
		const promptText = chatStore.undo();
		pendingInputRestore = promptText ?? '';
		if (promptText !== null) {
			pushGhost(promptText);
			clearPendingRestore();
		}
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
	<!-- Connection status banner (always visible, top-pinned) -->
	<ConnectionBanner />

	<!--
		Both layout branches are always in the DOM and stacked via
		position:absolute so Svelte's overlapping in/out transitions
		don't break the flex flow. Only the active branch is visible
		at any time; opacity/pointer-events hide the inactive one.
	-->
	<div class="chat-layers">
		<!-- ===== Zero-state: composer centred ===== -->
		<section
			class="chat-zero-state"
			class:is-hidden={hasMessages}
			aria-label="New chat"
			aria-hidden={hasMessages}
		>
			<header class="zero-heading">
				<h1 class="zero-title">What can I help you with?</h1>
				<p class="zero-hint">Ask Elefant anything, or start with a /command</p>
			</header>

			<div class="zero-input">
				<UnifiedChatInput
					disabled={chatStore.isStreaming}
					streaming={chatStore.isStreaming}
					onSend={handleSend}
					onStop={handleStop}
					onUndoShortcut={handleUndoShortcut}
					onRedoShortcut={handleRedoShortcut}
					restoreValue={pendingInputRestore}
				/>
			</div>
		</section>

		<!-- ===== Active state: messages above, composer pinned below ===== -->
		<section
			class="chat-active-state"
			class:is-hidden={!hasMessages}
			aria-label="Chat conversation"
			aria-hidden={!hasMessages}
		>
			<div class="chat-messages" aria-live="polite">
				<MessageList
					messages={chatStore.messages}
					onUndoMessage={handleUndoMessage}
					{ghostEntries}
					onGhostRedo={handleGhostRedo}
					onGhostDismiss={handleGhostDismiss}
				/>
			</div>

			{#if chatStore.canRedo}
				<RedoBanner
					redoCount={chatStore.redoCount}
					onRedo={() => chatStore.redo()}
				/>
			{/if}

			<div class="chat-active-input">
				<UnifiedChatInput
					disabled={chatStore.isStreaming}
					streaming={chatStore.isStreaming}
					onSend={handleSend}
					onStop={handleStop}
					onUndoShortcut={handleUndoShortcut}
					onRedoShortcut={handleRedoShortcut}
					restoreValue={pendingInputRestore}
				/>
			</div>
		</section>
	</div>
</div>

<style>
	/* ----- Root ---------------------------------------------------------
	 * Fills the content area. The banner sits at the top (auto height),
	 * then .chat-layers claims all remaining space via flex:1.
	 */
	.chat-view {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background-color: var(--surface-substrate);
	}

	/* ----- Layers container --------------------------------------------
	 * position:relative + flex:1 so it fills the space below the banner.
	 * Both child sections are absolutely stacked inside so transitions
	 * never disrupt the parent flex flow.
	 */
	.chat-layers {
		flex: 1;
		min-height: 0;
		position: relative;
	}

	/* ----- Shared section base -----------------------------------------
	 * Both branches fill the layers container absolutely and transition
	 * their opacity. Using opacity+pointer-events instead of
	 * display:none keeps both in the render tree (scroll positions,
	 * focus, etc.) but only one is interactive/visible at a time.
	 */
	.chat-zero-state,
	.chat-active-state {
		position: absolute;
		inset: 0;
		transition: opacity var(--transition-base);
	}

	.chat-zero-state.is-hidden,
	.chat-active-state.is-hidden {
		opacity: 0;
		pointer-events: none;
	}

	/* ----- Zero-state: centred composer -------------------------------- */
	.chat-zero-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-7) var(--space-5);
		gap: var(--space-7);
		overflow: hidden;
	}

	.zero-heading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		text-align: center;
		max-width: 640px;
	}

	.zero-title {
		font-family: var(--font-display);
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 400;
		line-height: 1.15;
		letter-spacing: -0.02em;
		color: var(--text-prose);
		margin: 0;
	}

	.zero-hint {
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		line-height: 1.5;
		color: var(--text-meta);
		margin: 0;
	}

	.zero-input {
		width: 100%;
		max-width: 640px;
	}

	/* ----- Active state: messages + bottom-pinned composer ------------- */
	.chat-active-state {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.chat-messages {
		flex: 1;
		min-height: 0;
		position: relative;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.chat-active-input {
		flex: 0 0 auto;
		width: 100%;
		/* Bottom padding uses max() so the iOS home indicator inset acts
		   as a floor — keeps existing desktop spacing intact while
		   pushing the input above the safe-area on mobile. */
		padding: var(--space-3) var(--space-4)
			max(var(--space-4), env(safe-area-inset-bottom));
	}

	/* ----- Reduced motion ---------------------------------------------- */
	@media (prefers-reduced-motion: reduce) {
		.chat-zero-state,
		.chat-active-state {
			transition: none;
		}
	}
</style>
