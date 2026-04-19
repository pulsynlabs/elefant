<script lang="ts">
	// ChatView — project-first chat composer.
	//
	// Every conversation is a session under a project. Sending a prompt
	// spawns an agent run via `agentRunsStore.spawn()`; the daemon runs
	// the agent loop and streams events back over the project SSE
	// stream. We render the *active* run's transcript inline so the chat
	// surface always shows the most recent exchange for this session.
	//
	// What this view owns:
	//   - Composer surface (provider selector, advanced options, override
	//     dialog, message input)
	//   - Spawn on send, cancel on stop
	//   - Auto-select the most recent run for the active session so the
	//     user sees their transcript the moment they switch sessions
	//
	// What this view delegates:
	//   - All streaming, tool-call rendering, and terminal-state display
	//     belongs to AgentRunTranscript.
	//   - All run-level state (status, transcript, active run) lives in
	//     agentRunsStore.

	import { chatStore } from './chat.svelte.js';
	import MessageInput from './MessageInput.svelte';
	import ProviderSelector from './ProviderSelector.svelte';
	import AdvancedOptions from './AdvancedOptions.svelte';
	import ConnectionBanner from './ConnectionBanner.svelte';
	import AgentOverrideDialog from '../agent-config/AgentOverrideDialog.svelte';
	import AgentRunTranscript from '../agent-runs/AgentRunTranscript.svelte';
	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import type { AgentRunOverride } from '$lib/types/agent-config.js';

	let showAdvanced = $state(false);
	let showOverrideDialog = $state(false);

	// Keep a record of the project+session we last synced to so the
	// refresh/subscribe effect only fires on an actual change. Without
	// this guard, the effect would re-run on every run-store mutation.
	let lastSyncedProjectId = $state<string | null>(null);
	let lastSyncedSessionId = $state<string | null>(null);

	// When the active session changes, wire up SSE for the project and
	// load the existing runs for that session. Auto-select the most
	// recent run so the user lands on their transcript immediately.
	$effect(() => {
		const projectId = projectsStore.activeProjectId;
		const sessionId = projectsStore.activeSessionId;

		if (
			projectId === lastSyncedProjectId &&
			sessionId === lastSyncedSessionId
		) {
			return;
		}
		lastSyncedProjectId = projectId;
		lastSyncedSessionId = sessionId;

		if (!projectId || !sessionId) {
			agentRunsStore.setActiveRun(null);
			return;
		}

		agentRunsStore.subscribeToProject(projectId);
		void agentRunsStore.refreshSession(sessionId).then(() => {
			// Pick the most recent run for this session as the active one.
			// runsForSession returns runs oldest-first, so take the tail.
			const sessionRuns = agentRunsStore.runsForSession(sessionId);
			const latest = sessionRuns.at(-1);
			agentRunsStore.setActiveRun(latest ? latest.runId : null);
		});
	});

	// Active run derivation — reads straight through so we don't have to
	// keep another piece of local state in sync.
	const activeRunId = $derived(agentRunsStore.activeRunId);
	const activeRun = $derived(
		activeRunId ? agentRunsStore.runs[activeRunId] ?? null : null,
	);
	const isStreaming = $derived(activeRun?.status === 'running');

	const hasContext = $derived(
		projectsStore.activeProjectId !== null &&
			projectsStore.activeSessionId !== null,
	);

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
		const prompt = content.trim();
		if (!prompt || isStreaming) return;

		const projectId = projectsStore.activeProjectId;
		const sessionId = projectsStore.activeSessionId;
		if (!projectId || !sessionId) return;

		// The per-run override `agentType` slot is the closest spec-legal
		// home for the override's provider choice until the spawn API
		// grows explicit per-run overrides. When an override is set, tag
		// the run with `primary:<provider>` so downstream tooling can
		// display it; otherwise default to the canonical primary agent.
		const override = chatStore.getAgentOverride();
		const provider = override.provider ?? chatStore.selectedProvider ?? null;
		const agentType = override.provider
			? `primary:${override.provider}`
			: 'primary';

		// Keep the title short and meaningful. The daemon rejects empty
		// titles, so fall back to the run type when the prompt is empty
		// after trimming (already guarded above, but defensive).
		const title = prompt.slice(0, 60) || 'primary';

		await agentRunsStore.spawn(projectId, sessionId, {
			agentType,
			title,
			prompt,
			contextMode: 'inherit_session',
		});

		// Note: spawn() sets the new runId as active and subscribes to
		// the project SSE stream internally, so there's nothing further
		// to wire up here. `provider` is read above for future expansion
		// when the spawn API accepts explicit per-run generation config.
		void provider;
	}

	async function handleStop(): Promise<void> {
		const runId = agentRunsStore.activeRunId;
		if (!runId) return;
		await agentRunsStore.cancel(runId);
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

	<!-- Transcript area (scrollable) -->
	<div class="chat-messages">
		{#if !hasContext}
			<div class="empty-state" role="status">
				<div class="empty-icon" aria-hidden="true">🐘</div>
				<h3 class="empty-title">Select a project and session</h3>
				<p class="empty-desc">
					Chat is always scoped to a session under a project. Pick one
					from the sidebar — or create a new session — to start talking
					to Elefant.
				</p>
			</div>
		{:else if !activeRunId}
			<div class="empty-state" role="status">
				<div class="empty-icon" aria-hidden="true">🐘</div>
				<h3 class="empty-title">Start a conversation</h3>
				<p class="empty-desc">
					Send a message to spin up the first agent run for this
					session.
				</p>
			</div>
		{:else}
			<div class="transcript-wrapper">
				<AgentRunTranscript />
			</div>
		{/if}
	</div>

	<!-- Advanced options (collapsible) -->
	{#if showAdvanced}
		<div class="advanced-section glass-sm">
			<AdvancedOptions />
		</div>
	{/if}

	<!-- Composer -->
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
			disabled={!hasContext || isStreaming}
			streaming={isStreaming}
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
		grid-template-rows: auto auto 1fr auto auto;
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

	.transcript-wrapper {
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-10) var(--space-6);
		text-align: center;
		gap: var(--space-3);
		color: var(--color-text-muted);
		flex: 1;
	}

	.empty-icon {
		font-size: 40px;
		opacity: 0.7;
	}

	.empty-title {
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		margin: 0;
	}

	.empty-desc {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		max-width: 420px;
		line-height: var(--line-height-relaxed);
		margin: 0;
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
