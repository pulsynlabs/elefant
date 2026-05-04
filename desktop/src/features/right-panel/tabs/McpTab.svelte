<script lang="ts">
	/**
	 * MCP tab for the right-side session panel (MH3 / W3.T1).
	 *
	 * Responsibilities:
	 *
	 *  1. Load the global MCP server list once on mount and re-load on
	 *     `mcp.status.changed` / `mcp.tools.changed` SSE events. We
	 *     deliberately re-fetch the whole list rather than mutating local
	 *     state from event payloads — the daemon is the single source of
	 *     truth for connection status, tool counts, and the persisted
	 *     `enabled` flag.
	 *
	 *  2. Maintain a local Set of session-disabled server IDs (the W2.T5
	 *     overlay). The daemon owns the canonical map but does not yet
	 *     expose a GET endpoint for it, so we treat the local Set as
	 *     authoritative-for-this-mount: it starts empty (a fresh session
	 *     has no overrides) and is updated optimistically on toggle
	 *     plus reconciled from `mcp.session.toggled` SSE events.
	 *
	 *  3. Render compact `<McpServerCard>`s and proxy toggle clicks to the
	 *     W2.T5 routes via `mcpService.setSessionDisabled`. Optimistic
	 *     update + 1s error flash + revert on failure.
	 *
	 * Out of scope for this tab — by spec:
	 *   - Adding/removing/editing servers (Settings owns that)
	 *   - Per-tool pinning / inspection (Settings owns that)
	 *
	 * Keep this strictly a quick-access viewer + session toggler.
	 */
	import type {
		McpServerWithStatus,
		McpStatusEvent,
	} from '$lib/daemon/types.js';
	import { mcpService } from '$lib/services/mcp-service.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { onMount, onDestroy } from 'svelte';
	import {
		HugeiconsIcon,
		McpServerIcon,
		SettingsIcon,
		RefreshIcon,
		WarningIcon,
	} from '$lib/icons/index.js';
	import McpServerCard from './McpServerCard.svelte';

	type Props = {
		/**
		 * Optional callback invoked when the user clicks the empty-state
		 * "Open Settings" link. Caller is responsible for routing to the
		 * MCP settings view. If omitted, the link is hidden.
		 */
		onOpenSettings?: () => void;
	};

	let { onOpenSettings }: Props = $props();

	// --- State -----------------------------------------------------------

	let servers = $state<McpServerWithStatus[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	// Per-server transient UI state. Kept in two records (rather than
	// nested inside `servers`) so we don't have to re-derive whenever the
	// list re-loads from the daemon. Keys are server IDs.
	let sessionDisabled = $state<Record<string, boolean>>({});
	let busyByServer = $state<Record<string, boolean>>({});
	let errorFlashByServer = $state<Record<string, boolean>>({});

	// Outstanding error-flash timers, so we can clear them on unmount and
	// avoid setting state on an unmounted component.
	const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

	let unsubscribeStatus: (() => void) | null = null;

	// --- Lifecycle -------------------------------------------------------

	onMount(() => {
		void loadServers();

		try {
			unsubscribeStatus = mcpService.subscribeToStatus((event) =>
				handleSseEvent(event),
			);
		} catch {
			// EventSource unavailable (e.g. test env without polyfill); the
			// list is still functional via the manual refresh button.
		}
	});

	onDestroy(() => {
		if (unsubscribeStatus) unsubscribeStatus();
		for (const timer of flashTimers.values()) clearTimeout(timer);
		flashTimers.clear();
	});

	// --- Data loading ----------------------------------------------------

	async function loadServers(): Promise<void> {
		loading = true;
		loadError = null;
		try {
			servers = await mcpService.listServers();
		} catch (err) {
			loadError =
				err instanceof Error ? err.message : 'Failed to load MCP servers';
			servers = [];
		} finally {
			loading = false;
		}
	}

	// --- SSE handling ----------------------------------------------------

	function handleSseEvent(event: McpStatusEvent): void {
		const activeSessionId = projectsStore.activeSessionId;

		if (event.type === 'mcp.session.toggled') {
			// Only honor session-toggle events that target the active
			// session. Toggles for other sessions don't affect this view.
			if (
				event.sessionId &&
				activeSessionId &&
				event.sessionId === activeSessionId &&
				typeof event.disabled === 'boolean'
			) {
				sessionDisabled = {
					...sessionDisabled,
					[event.serverId]: event.disabled,
				};
			}
			return;
		}

		// status / tools changed → re-fetch full list to pick up updated
		// `status`, `error`, `toolCount`. Cheap on small lists; if this ever
		// becomes a perf concern we can switch to per-server `getServer`.
		void loadServers();
	}

	// --- Toggle handling -------------------------------------------------

	async function handleToggle(
		server: McpServerWithStatus,
		nextSessionDisabled: boolean,
	): Promise<void> {
		const projectId = projectsStore.activeProjectId;
		const sessionId = projectsStore.activeSessionId;

		// Defensive: parent (RightPanel) gates rendering on session
		// existence, but a race during session-switch could land us here
		// without one. Refuse silently rather than POST a bad URL.
		if (!projectId || !sessionId) return;
		if (busyByServer[server.id]) return;

		const previous = sessionDisabled[server.id] ?? false;

		// Optimistic update — flip immediately so the UI feels instant.
		// SSE will confirm shortly after; on failure we revert below.
		sessionDisabled = {
			...sessionDisabled,
			[server.id]: nextSessionDisabled,
		};
		busyByServer = { ...busyByServer, [server.id]: true };

		try {
			await mcpService.setSessionDisabled(
				projectId,
				sessionId,
				server.id,
				nextSessionDisabled,
			);
		} catch {
			// Revert and flash the card border red for ~1s.
			sessionDisabled = {
				...sessionDisabled,
				[server.id]: previous,
			};
			triggerErrorFlash(server.id);
		} finally {
			busyByServer = { ...busyByServer, [server.id]: false };
		}
	}

	function triggerErrorFlash(serverId: string): void {
		errorFlashByServer = { ...errorFlashByServer, [serverId]: true };
		const existing = flashTimers.get(serverId);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			errorFlashByServer = { ...errorFlashByServer, [serverId]: false };
			flashTimers.delete(serverId);
		}, 1000);
		flashTimers.set(serverId, timer);
	}

	// --- Derived ---------------------------------------------------------

	// Stable visual order: connected → connecting → idle/disabled → failed,
	// then alphabetical by name within each bucket. Failures bubble down
	// rather than up so they don't shout over a working stack.
	const sortedServers = $derived.by<McpServerWithStatus[]>(() => {
		const rank: Record<McpServerWithStatus['status'], number> = {
			connected: 0,
			connecting: 1,
			disabled: 2,
			failed: 3,
		};
		return [...servers].sort((a, b) => {
			const ra = rank[a.status] ?? 99;
			const rb = rank[b.status] ?? 99;
			if (ra !== rb) return ra - rb;
			return a.name.localeCompare(b.name);
		});
	});

	const isEmpty = $derived(!loading && !loadError && servers.length === 0);
</script>

<div class="mcp-tab" data-testid="right-panel-mcp-tab">
	{#if loading}
		<div class="state-block" role="status" aria-live="polite">
			<HugeiconsIcon
				icon={RefreshIcon}
				size={20}
				strokeWidth={1.5}
				color="var(--text-meta)"
			/>
			<p class="state-text">Loading MCP servers…</p>
		</div>
	{:else if loadError}
		<div class="state-block error" role="alert">
			<HugeiconsIcon
				icon={WarningIcon}
				size={20}
				strokeWidth={1.5}
				color="var(--color-error)"
			/>
			<p class="state-text">{loadError}</p>
			<button type="button" class="text-button" onclick={() => void loadServers()}>
				<HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={1.6} />
				<span>Retry</span>
			</button>
		</div>
	{:else if isEmpty}
		<div class="state-block">
			<HugeiconsIcon
				icon={McpServerIcon}
				size={24}
				strokeWidth={1.4}
				color="var(--text-meta)"
			/>
			<p class="state-text">No MCP servers configured.</p>
			{#if onOpenSettings}
				<button
					type="button"
					class="text-button"
					onclick={() => onOpenSettings?.()}
				>
					<HugeiconsIcon icon={SettingsIcon} size={12} strokeWidth={1.6} />
					<span>Add servers in Settings</span>
				</button>
			{:else}
				<p class="state-meta">Add servers in Settings.</p>
			{/if}
		</div>
	{:else}
		<ul class="server-list" role="list">
			{#each sortedServers as server (server.id)}
				<li>
					<McpServerCard
						{server}
						sessionDisabled={sessionDisabled[server.id] ?? false}
						errorFlash={errorFlashByServer[server.id] ?? false}
						busy={busyByServer[server.id] ?? false}
						onToggle={(next) => void handleToggle(server, next)}
					/>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.mcp-tab {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		padding: var(--space-2);
		gap: var(--space-2);
		overflow-y: auto;
	}

	.server-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.state-block {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6) var(--space-4);
		text-align: center;
		color: var(--text-meta);
	}

	.state-block.error {
		color: var(--text-prose);
	}

	.state-text {
		margin: 0;
		font-size: 13px;
		line-height: 1.4;
	}

	.state-meta {
		margin: 0;
		font-size: 11px;
		color: var(--text-muted);
	}

	.text-button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 4px 8px;
		background: transparent;
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-sm, 4px);
		color: var(--text-meta);
		font-family: inherit;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.text-button:hover {
		color: var(--text-prose);
		background-color: var(--surface-hover);
		border-color: var(--border-emphasis);
	}

	.text-button:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}
</style>
