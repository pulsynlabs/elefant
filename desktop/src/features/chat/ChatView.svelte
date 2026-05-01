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
	import MessageList from './MessageList.svelte';
	import UnifiedChatInput from './UnifiedChatInput.svelte';
	import ConnectionBanner from './ConnectionBanner.svelte';
	import { getDaemonClient } from '$lib/daemon/client.js';
	import type { MessageRole } from '$lib/daemon/types.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import { fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

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

	// --- Layout state ---------------------------------------------------
	//
	// The view picks one of two arrangements based on whether the
	// conversation has any messages yet. We swap the entire branch via
	// `{#if hasMessages}` so layout differences (centred vs bottom-pinned)
	// don't fight each other inside a single grid.
	const hasMessages = $derived(chatStore.messages.length > 0);

	// `prefers-reduced-motion`-aware duration helper.
	//
	// Svelte's `fade` directive can't be disabled by CSS — `transition:none`
	// in @media (prefers-reduced-motion: reduce) doesn't apply because the
	// directive drives style updates via JS, not CSS transition. The clean
	// fix is to inspect the media query at call time and zero the duration
	// when the user has opted out of motion. We also guard `window` so SSR
	// / non-browser test environments don't crash.
	//
	// The `base` values passed by callers below are aligned with the Quire
	// duration scale (--duration-fast = 150ms, --duration-base = 250ms).
	// We can't `var(--duration-base)` directly into a JS number, so the
	// scale is mirrored at call sites with comments tying them back to the
	// tokens.
	function motionDuration(base: number): number {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return base;
		}
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : base;
	}

	// Mirror Quire motion tokens (typography.css / tokens.css):
	//   FADE_IN_MS  → matches `--duration-base` (250ms) — slightly
	//                 trimmed to 200ms so the swap feels brisk, not heavy.
	//   FADE_OUT_MS → matches `--duration-fast`  (150ms) exactly — we
	//                 always exit faster than we enter.
	const FADE_IN_MS = 200;
	const FADE_OUT_MS = 150;
</script>

<div class="chat-view">
	<!-- Connection status banner (always visible, top-pinned) -->
	<ConnectionBanner />

	{#if !hasMessages}
		<!-- ===== Zero-state: composer centred in the viewport ===== -->
		<section
			class="chat-zero-state"
			aria-label="New chat"
			in:fade={{ duration: motionDuration(FADE_IN_MS), easing: quintOut }}
			out:fade={{ duration: motionDuration(FADE_OUT_MS), easing: quintOut }}
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
				/>
			</div>
		</section>
	{:else}
		<!-- ===== Active state: messages above, composer pinned below ===== -->
		<section
			class="chat-active-state"
			aria-label="Chat conversation"
			in:fade={{ duration: motionDuration(FADE_IN_MS), easing: quintOut }}
		>
			<div class="chat-messages" aria-live="polite">
				<MessageList messages={chatStore.messages} />
			</div>

			<div class="chat-active-input">
				<UnifiedChatInput
					disabled={chatStore.isStreaming}
					streaming={chatStore.isStreaming}
					onSend={handleSend}
					onStop={handleStop}
				/>
			</div>
		</section>
	{/if}
</div>

<style>
	/* ----- Root ---------------------------------------------------------
	 * The view fills its container as a vertical flex column. The banner
	 * sits at the top; the active branch (zero-state OR active-state)
	 * fills the remaining space. Overflow is hidden so internal scroll
	 * regions own scrolling, not the viewport.
	 */
	.chat-view {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background-color: var(--surface-substrate);
	}

	/* ----- Zero-state: centred composer --------------------------------
	 * `flex: 1` claims the remaining height below the banner, then the
	 * inner flex column centres its children both axes. The hint heading
	 * gets generous space above the composer to feel deliberate, not
	 * cramped.
	 */
	.chat-zero-state {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-7) var(--space-5);
		gap: var(--space-7);
	}

	.zero-heading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		text-align: center;
		max-width: 640px;
	}

	/* DM Serif Display — the editorial voice that signals "this is a
	 * fresh page". Matches the typographic system documented in
	 * styles/typography.css. */
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

	/* ----- Active state: messages + bottom-pinned composer -------------
	 * Vertical flex column: messages take the elastic middle, composer
	 * is auto-sized at the bottom. We constrain composer width and
	 * centre it horizontally so long-form viewports don't stretch the
	 * input edge-to-edge — better reading rhythm and aligns with the
	 * messages column above.
	 */
	.chat-active-state {
		flex: 1;
		min-height: 0;
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
		max-width: 800px;
		margin: 0 auto;
		padding: var(--space-3) var(--space-5) var(--space-5);
	}

	/* ----- Reduced motion ----------------------------------------------
	 * The Svelte `fade` directive is JS-driven, so we zero its duration
	 * at the call site (see `motionDuration()`). The CSS reset below is
	 * defensive belt-and-braces in case future contributors add
	 * CSS-driven transitions to either branch.
	 */
	@media (prefers-reduced-motion: reduce) {
		.chat-zero-state,
		.chat-active-state {
			transition: none;
		}
	}
</style>
