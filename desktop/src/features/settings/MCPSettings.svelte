<script lang="ts">
	import type {
		McpServerConfig,
		McpServerWithStatus,
		McpToolEntry,
		RegistryEntry,
	} from '$lib/daemon/types.js';
	import { mcpService } from '$lib/services/mcp-service.js';
	import { onMount, onDestroy } from 'svelte';
	import MCPStatusBadge from './MCPStatusBadge.svelte';
	import MCPServerForm from './MCPServerForm.svelte';
	import MCPRegistryBrowser from './MCPRegistryBrowser.svelte';
	import {
		HugeiconsIcon,
		PlugIcon,
		McpServerIcon,
		LinkIcon,
		PinIcon,
		PinOffIcon,
		ChevronDownIcon,
		ChevronRightIcon,
	} from '$lib/icons/index.js';

	const TOOL_DESCRIPTION_TRUNCATE = 200;

	let servers = $state<McpServerWithStatus[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let status = $state<{ type: 'success' | 'error'; message: string } | null>(
		null,
	);

	// Inline form state
	let showForm = $state(false);
	let editingServer = $state<McpServerConfig | undefined>(undefined);
	let prefilledTemplate = $state<Partial<McpServerConfig> | undefined>(
		undefined,
	);

	// Registry browser
	let showRegistry = $state(false);

	// Per-server tool state. Keyed by server id.
	type ToolsState = {
		expanded: boolean;
		loading: boolean;
		error: string | null;
		tools: McpToolEntry[];
	};
	let toolsByServer = $state<Record<string, ToolsState>>({});

	// Per-tool "show more" state for long descriptions, keyed by `${serverId}::${toolName}`.
	let expandedDescriptions = $state<Record<string, boolean>>({});

	// SSE subscription cleanup
	let unsubscribeStatus: (() => void) | null = null;
	let statusTimeout: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		void loadServers();
		// Subscribe to live status updates. The handler refetches the affected
		// server rather than mutating local state from the event payload —
		// the daemon is the single source of truth.
		try {
			unsubscribeStatus = mcpService.subscribeToStatus(async (event) => {
				try {
					if (event.type === 'mcp.status.changed') {
						const next = await mcpService.getServer(event.serverId);
						servers = servers.map((s) => (s.id === event.serverId ? next : s));
					} else if (event.type === 'mcp.tools.changed') {
						const current = toolsByServer[event.serverId];
						if (current?.expanded) {
							await loadToolsFor(event.serverId);
						} else if (current) {
							toolsByServer = {
								...toolsByServer,
								[event.serverId]: { ...current, tools: [] },
							};
						}
					}
				} catch {
					// Ignore — manual refresh remains the fallback.
				}
			});
		} catch {
			// EventSource unavailable; the list is still usable manually.
		}
	});

	onDestroy(() => {
		if (unsubscribeStatus) unsubscribeStatus();
		if (statusTimeout) clearTimeout(statusTimeout);
	});

	async function loadServers(): Promise<void> {
		loading = true;
		loadError = null;
		try {
			servers = await mcpService.listServers();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load servers';
			servers = [];
		} finally {
			loading = false;
		}
	}

	function flashStatus(
		type: 'success' | 'error',
		message: string,
	): void {
		status = { type, message };
		if (statusTimeout) clearTimeout(statusTimeout);
		statusTimeout = setTimeout(() => {
			status = null;
		}, 3_000);
	}

	function openAdd(): void {
		editingServer = undefined;
		prefilledTemplate = undefined;
		showRegistry = false;
		showForm = true;
	}

	function openEdit(server: McpServerWithStatus): void {
		editingServer = server;
		prefilledTemplate = undefined;
		showRegistry = false;
		showForm = true;
	}

	function closeForm(): void {
		showForm = false;
		editingServer = undefined;
		prefilledTemplate = undefined;
	}

	function toggleRegistry(): void {
		showRegistry = !showRegistry;
		if (showRegistry) {
			showForm = false;
			editingServer = undefined;
			prefilledTemplate = undefined;
		}
	}

	function handleAddFromRegistry(entry: RegistryEntry): void {
		// Pre-fill the form from a registry entry. We deliberately don't
		// auto-save — users may want to tweak env vars or rename before
		// committing.
		prefilledTemplate = {
			name: entry.name,
			transport: entry.transport,
			command: entry.command,
			url: entry.url,
			enabled: true,
			timeout: 30_000,
		};
		editingServer = undefined;
		showRegistry = false;
		showForm = true;
	}

	async function handleSaved(): Promise<void> {
		showForm = false;
		editingServer = undefined;
		prefilledTemplate = undefined;
		flashStatus('success', 'Server saved');
		await loadServers();
	}

	async function handleDelete(server: McpServerWithStatus): Promise<void> {
		try {
			await mcpService.deleteServer(server.id);
			flashStatus('success', `Deleted "${server.name}"`);
			await loadServers();
		} catch (err) {
			flashStatus(
				'error',
				err instanceof Error ? err.message : 'Failed to delete server',
			);
		}
	}

	async function handleToggleEnabled(
		server: McpServerWithStatus,
	): Promise<void> {
		try {
			await mcpService.updateServer(server.id, { enabled: !server.enabled });
			await loadServers();
		} catch (err) {
			flashStatus(
				'error',
				err instanceof Error ? err.message : 'Failed to toggle server',
			);
		}
	}

	async function handleRetry(server: McpServerWithStatus): Promise<void> {
		try {
			await mcpService.connectServer(server.id);
			flashStatus('success', `Reconnecting "${server.name}"`);
			await loadServers();
		} catch (err) {
			flashStatus(
				'error',
				err instanceof Error ? err.message : 'Failed to reconnect',
			);
		}
	}

	async function toggleTools(server: McpServerWithStatus): Promise<void> {
		const current = toolsByServer[server.id];
		const expanded = !(current?.expanded ?? false);
		const initial: ToolsState = {
			expanded,
			loading: false,
			error: null,
			tools: current?.tools ?? [],
		};
		toolsByServer = { ...toolsByServer, [server.id]: initial };
		// Lazy-load on first expand. Subsequent expands reuse the cached list
		// unless a tools.changed SSE event has cleared it.
		if (expanded && initial.tools.length === 0) {
			await loadToolsFor(server.id);
		}
	}

	async function loadToolsFor(serverId: string): Promise<void> {
		const prev = toolsByServer[serverId];
		toolsByServer = {
			...toolsByServer,
			[serverId]: {
				expanded: prev?.expanded ?? true,
				loading: true,
				error: null,
				tools: prev?.tools ?? [],
			},
		};
		try {
			const tools = await mcpService.listServerTools(serverId);
			toolsByServer = {
				...toolsByServer,
				[serverId]: {
					expanded: true,
					loading: false,
					error: null,
					tools,
				},
			};
		} catch (err) {
			toolsByServer = {
				...toolsByServer,
				[serverId]: {
					expanded: true,
					loading: false,
					error: err instanceof Error ? err.message : 'Failed to load tools',
					tools: [],
				},
			};
		}
	}

	async function handlePinTool(
		server: McpServerWithStatus,
		tool: McpToolEntry,
	): Promise<void> {
		const newPinned = !tool.pinned;
		// Optimistic update for snappy feedback; revert on failure.
		const state = toolsByServer[server.id];
		if (state) {
			toolsByServer = {
				...toolsByServer,
				[server.id]: {
					...state,
					tools: state.tools.map((t) =>
						t.name === tool.name ? { ...t, pinned: newPinned } : t,
					),
				},
			};
		}
		try {
			await mcpService.pinTool(server.id, tool.name, newPinned);
		} catch (err) {
			if (state) {
				toolsByServer = {
					...toolsByServer,
					[server.id]: {
						...state,
						tools: state.tools.map((t) =>
							t.name === tool.name ? { ...t, pinned: tool.pinned } : t,
						),
					},
				};
			}
			flashStatus(
				'error',
				err instanceof Error ? err.message : 'Failed to update pin',
			);
		}
	}

	function descriptionKey(serverId: string, toolName: string): string {
		return `${serverId}::${toolName}`;
	}

	function toggleDescription(serverId: string, toolName: string): void {
		const key = descriptionKey(serverId, toolName);
		expandedDescriptions = {
			...expandedDescriptions,
			[key]: !expandedDescriptions[key],
		};
	}

	function transportIconFor(
		transport: McpServerConfig['transport'],
	): typeof PlugIcon {
		// stdio = local plug; remote variants share the link icon.
		return transport === 'stdio' ? PlugIcon : LinkIcon;
	}

	function transportShortLabel(
		transport: McpServerConfig['transport'],
	): string {
		if (transport === 'stdio') return 'stdio';
		if (transport === 'sse') return 'sse';
		return 'http';
	}
</script>

<div class="mcp-settings">
	<div class="section-header">
		<h3 class="section-heading">MCP Servers</h3>
		<div class="header-actions">
			<button class="btn-secondary" type="button" onclick={toggleRegistry}>
				{showRegistry ? 'Close Registry' : 'Browse Registry'}
			</button>
			<button class="btn-primary" type="button" onclick={openAdd}>
				+ Add Server
			</button>
		</div>
	</div>

	{#if status}
		<div
			class="status-message"
			class:error={status.type === 'error'}
			role="status"
		>
			{status.message}
		</div>
	{/if}

	{#if showRegistry}
		<MCPRegistryBrowser
			onAddEntry={handleAddFromRegistry}
			onClose={() => (showRegistry = false)}
		/>
	{/if}

	{#if showForm}
		<MCPServerForm
			editing={editingServer}
			template={prefilledTemplate}
			onSaved={handleSaved}
			onCancel={closeForm}
		/>
	{/if}

	{#if loading}
		<div class="state">
			<div class="spinner" aria-hidden="true"></div>
			<p>Loading MCP servers…</p>
		</div>
	{:else if loadError}
		<div class="state state-error" role="alert">
			<p>{loadError}</p>
			<button class="btn-link" type="button" onclick={loadServers}>
				Retry
			</button>
		</div>
	{:else if servers.length === 0 && !showForm && !showRegistry}
		<div class="empty">
			<HugeiconsIcon icon={McpServerIcon} size={28} />
			<p class="empty-text">No MCP servers configured.</p>
			<p class="empty-hint">Add one or browse the registry.</p>
		</div>
	{:else if servers.length > 0}
		<ul class="server-list" role="list">
			{#each servers as server (server.id)}
				{@const toolState = toolsByServer[server.id]}
				{@const isExpanded = toolState?.expanded ?? false}
				<li class="server-item" class:expanded={isExpanded}>
					<div class="server-row">
						<button
							class="expand-btn"
							type="button"
							onclick={() => toggleTools(server)}
							aria-expanded={isExpanded}
							aria-label={isExpanded ? 'Collapse tools' : 'Expand tools'}
						>
							<HugeiconsIcon
								icon={isExpanded ? ChevronDownIcon : ChevronRightIcon}
								size={16}
							/>
						</button>

						<div class="server-info">
							<HugeiconsIcon
								icon={transportIconFor(server.transport)}
								size={18}
								strokeWidth={1.5}
							/>
							<span class="server-name">{server.name}</span>
							<span class="transport-tag" aria-label="Transport">
								{transportShortLabel(server.transport)}
							</span>
						</div>

						<div class="server-meta">
							<MCPStatusBadge status={server.status} />
							{#if typeof server.toolCount === 'number'}
								<span class="tool-count">{server.toolCount} tools</span>
							{/if}
						</div>

						<div class="server-actions">
							<label
								class="toggle-label"
								title={server.enabled ? 'Disable' : 'Enable'}
							>
								<input
									type="checkbox"
									checked={server.enabled ?? true}
									onchange={() => handleToggleEnabled(server)}
								/>
								<span class="toggle-text">Enabled</span>
							</label>
							{#if server.status === 'failed'}
								<button
									class="btn-action"
									type="button"
									onclick={() => handleRetry(server)}
								>
									Retry
								</button>
							{/if}
							<button
								class="btn-action"
								type="button"
								onclick={() => openEdit(server)}
								aria-label={`Edit ${server.name}`}
							>
								Edit
							</button>
							<button
								class="btn-action danger"
								type="button"
								onclick={() => handleDelete(server)}
								aria-label={`Delete ${server.name}`}
							>
								Delete
							</button>
						</div>
					</div>

					{#if server.error}
						<div class="server-error" role="alert">
							{server.error}
						</div>
					{/if}

					{#if isExpanded}
						<div class="tools-panel">
							{#if toolState?.loading}
								<div class="state state-inline">
									<div class="spinner" aria-hidden="true"></div>
									<span>Loading tools…</span>
								</div>
							{:else if toolState?.error}
								<div
									class="state state-inline state-error"
									role="alert"
								>
									<p>{toolState.error}</p>
									<button
										class="btn-link"
										type="button"
										onclick={() => loadToolsFor(server.id)}
									>
										Retry
									</button>
								</div>
							{:else if (toolState?.tools.length ?? 0) === 0}
								<p class="tools-empty">
									{server.status === 'connected'
										? 'This server exposes no tools.'
										: 'Tools will appear when the server is connected.'}
								</p>
							{:else}
								<ul class="tool-list" role="list">
									{#each toolState?.tools ?? [] as tool (tool.name)}
										{@const descKey = descriptionKey(server.id, tool.name)}
										{@const descExpanded = expandedDescriptions[descKey] ?? false}
										{@const isLong = (tool.description?.length ?? 0) > TOOL_DESCRIPTION_TRUNCATE}
										<li class="tool-row">
											<div class="tool-head">
												<span class="tool-name">{tool.name}</span>
												<button
													class="btn-pin"
													class:pinned={tool.pinned}
													type="button"
													onclick={() => handlePinTool(server, tool)}
													aria-label={tool.pinned ? 'Unpin tool' : 'Pin tool'}
													aria-pressed={tool.pinned}
												>
													<HugeiconsIcon
														icon={tool.pinned ? PinIcon : PinOffIcon}
														size={14}
														strokeWidth={1.5}
													/>
													<span>{tool.pinned ? 'Pinned' : 'Pin'}</span>
												</button>
											</div>
											{#if tool.description}
												<p class="tool-description">
													{descExpanded || !isLong
														? tool.description
														: `${tool.description.slice(0, TOOL_DESCRIPTION_TRUNCATE)}…`}
												</p>
												{#if isLong}
													<button
														class="btn-link btn-link-tiny"
														type="button"
														onclick={() => toggleDescription(server.id, tool.name)}
													>
														{descExpanded ? 'Show less' : 'Show more'}
													</button>
												{/if}
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.mcp-settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 880px;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.section-heading {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.header-actions {
		display: flex;
		gap: var(--space-2);
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition: background-color var(--transition-fast);
	}

	.btn-primary:hover {
		background-color: var(--color-primary-hover);
	}

	.btn-secondary {
		background-color: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn-secondary:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.status-message {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		background-color: color-mix(in oklch, var(--color-success) 10%, transparent);
		color: var(--color-success);
		border: 1px solid var(--color-success);
	}

	.status-message.error {
		background-color: color-mix(in oklch, var(--color-error) 10%, transparent);
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.empty {
		padding: var(--space-8) var(--space-5);
		text-align: center;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-muted);
	}

	.empty-text {
		color: var(--color-text-secondary);
		font-size: var(--font-size-md);
	}

	.empty-hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-6);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.state-inline {
		flex-direction: row;
		padding: var(--space-3);
		justify-content: flex-start;
	}

	.state-error {
		color: var(--color-error);
	}

	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2s;
		}
	}

	.btn-link {
		background: none;
		border: none;
		color: var(--color-primary);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		padding: 0;
	}

	.btn-link:hover {
		text-decoration: underline;
	}

	.btn-link-tiny {
		font-size: var(--font-size-xs);
		align-self: flex-start;
	}

	.server-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0;
		margin: 0;
	}

	.server-item {
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		transition: border-color var(--transition-fast);
		overflow: hidden;
	}

	.server-item:hover {
		border-color: var(--color-border-strong);
	}

	.server-item.expanded {
		border-color: var(--color-primary);
	}

	.server-row {
		display: grid;
		grid-template-columns: auto minmax(180px, 1.5fr) minmax(160px, auto) auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
	}

	.expand-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: var(--space-1);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.expand-btn:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.server-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		color: var(--color-text-secondary);
	}

	.server-name {
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		font-size: var(--font-size-md);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.transport-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 1px 6px;
		background-color: var(--color-surface-hover);
		border-radius: var(--radius-sm);
	}

	.server-meta {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.tool-count {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.server-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.toggle-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		cursor: pointer;
		user-select: none;
	}

	.toggle-text {
		display: none;
	}

	.btn-action {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn-action:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-action.danger:hover {
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.server-error {
		padding: var(--space-2) var(--space-4);
		font-size: var(--font-size-xs);
		color: var(--color-error);
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		border-top: 1px solid color-mix(in oklch, var(--color-error) 20%, transparent);
	}

	.tools-panel {
		border-top: 1px solid var(--color-border);
		padding: var(--space-3) var(--space-4);
		background-color: var(--color-surface-hover);
	}

	.tools-empty {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: var(--space-2) 0;
	}

	.tool-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0;
		margin: 0;
	}

	.tool-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.tool-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.tool-name {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
		font-weight: var(--font-weight-medium);
	}

	.tool-description {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.4;
	}

	.btn-pin {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		padding: 2px 8px;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.btn-pin:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-pin.pinned {
		color: var(--color-primary);
		border-color: var(--color-primary);
		background-color: color-mix(in oklch, var(--color-primary) 10%, transparent);
	}
</style>
