<script lang="ts">
	import { chatStore } from './chat.svelte.js';
	import MessageList from './MessageList.svelte';
	import MessageInput from './MessageInput.svelte';
	import ProviderSelector from './ProviderSelector.svelte';
	import AdvancedOptions from './AdvancedOptions.svelte';
	import ConnectionBanner from './ConnectionBanner.svelte';
	import { getDaemonClient } from '$lib/daemon/client.js';
	import type { MessageRole } from '$lib/daemon/types.js';

	let showAdvanced = $state(false);
	let abortController: AbortController | null = null;

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
			const stream = client.streamChat(
				{
					messages: apiMessages,
					provider: chatStore.selectedProvider ?? undefined,
					maxIterations: chatStore.maxIterations,
					maxTokens: chatStore.maxTokens > 0 ? chatStore.maxTokens : undefined,
					temperature: chatStore.temperature,
				},
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
		<button
			class="advanced-toggle mono-label"
			onclick={() => (showAdvanced = !showAdvanced)}
			aria-label="Toggle advanced options"
			aria-expanded={showAdvanced}
		>
			{showAdvanced ? '▲' : '▼'} Options
		</button>
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

	.advanced-toggle {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-muted);
		text-align: left;
		padding: var(--space-1) 0;
		transition: color var(--transition-fast);
	}

	.advanced-toggle:hover {
		color: var(--color-text-secondary);
	}
</style>
