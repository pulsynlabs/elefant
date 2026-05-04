<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { ServerConfig, ServerHealthStatus } from '$lib/types/server.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { connectionStore } from '$lib/stores/connection.svelte.js';
	import { registry } from '$lib/daemon/registry.js';
	import { configService } from '$lib/services/config-service.js';
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import {
		daemonLifecycle,
		type DaemonLifecycleStatus,
	} from '$lib/services/daemon-lifecycle.js';
	import { HugeiconsIcon, WarningIcon } from '$lib/icons/index.js';
	import ServerList from '$lib/components/servers/ServerList.svelte';
	import AddEditServerModal from '$lib/components/servers/AddEditServerModal.svelte';
	import { isCapacitorRuntime } from '$lib/runtime.js';

	// ─── Server list status state (synced from registry subscription) ────
	let statuses = $state<Record<string, ServerHealthStatus>>({});

	function seedStatuses(): void {
		const next: Record<string, ServerHealthStatus> = {};
		for (const server of settingsStore.servers) {
			next[server.id] = registry.getStatus(server.id).status;
		}
		statuses = next;
	}

	let unsubscribe: (() => void) | null = null;

	onMount(() => {
		seedStatuses();
		unsubscribe = registry.subscribe((serverId, entry) => {
			statuses = { ...statuses, [serverId]: entry.status };
		});
	});

	// Re-seed whenever the underlying server list changes (add / remove).
	$effect(() => {
		// Read servers to register dependency
		const ids = settingsStore.servers.map((s) => s.id);
		const knownIds = Object.keys(statuses);
		const added = ids.filter((id) => !knownIds.includes(id));
		const removed = knownIds.filter((id) => !ids.includes(id));
		if (added.length === 0 && removed.length === 0) return;

		seedStatuses();
	});

	onDestroy(() => {
		unsubscribe?.();
		unsubscribe = null;
	});

	// ─── Modal state ─────────────────────────────────────────────────────
	let modalOpen = $state(false);
	let editingServer = $state<ServerConfig | undefined>(undefined);
	let saveError = $state<string | null>(null);

	function openAddModal(): void {
		editingServer = undefined;
		saveError = null;
		modalOpen = true;
	}

	function openEditModal(id: string): void {
		const target = settingsStore.servers.find((s) => s.id === id);
		if (!target) return;
		editingServer = target;
		saveError = null;
		modalOpen = true;
	}

	function closeModal(): void {
		modalOpen = false;
		editingServer = undefined;
	}

	async function handleModalSave(data: Omit<ServerConfig, 'id'>): Promise<void> {
		saveError = null;
		try {
			if (editingServer) {
				await settingsStore.updateServer(editingServer.id, data);
				const updated = settingsStore.servers.find((s) => s.id === editingServer!.id);
				if (updated) {
					registry.register(updated);
				}
			} else {
				const beforeIds = new Set(settingsStore.servers.map((s) => s.id));
				await settingsStore.addServer(data);
				const created = settingsStore.servers.find((s) => !beforeIds.has(s.id));
				if (created) {
					registry.register(created);
				}
			}
			closeModal();
		} catch (error) {
			saveError =
				error instanceof Error
					? error.message
					: 'Failed to save server configuration';
		}
	}

	// ─── Server actions ──────────────────────────────────────────────────
	async function handleSelect(id: string): Promise<void> {
		try {
			await settingsStore.setActiveServer(id);
			registry.setActive(id);
			await connectionStore.checkNow();
		} catch (error) {
			saveError =
				error instanceof Error ? error.message : 'Failed to switch active server';
		}
	}

	async function handleRemove(id: string): Promise<void> {
		const target = settingsStore.servers.find((s) => s.id === id);
		if (!target) return;

		if (settingsStore.servers.length <= 1) {
			saveError = 'Cannot remove the only configured server.';
			return;
		}

		const confirmed = window.confirm(
			`Remove server "${target.displayName}"?\n\nThis cannot be undone.`,
		);
		if (!confirmed) return;

		try {
			await settingsStore.removeServer(id);
			registry.unregister(id);
		} catch (error) {
			saveError =
				error instanceof Error ? error.message : 'Failed to remove server';
		}
	}

	async function handleSetDefault(id: string): Promise<void> {
		try {
			await settingsStore.setDefaultServer(id);
		} catch (error) {
			saveError =
				error instanceof Error ? error.message : 'Failed to set default server';
		}
	}

	// ─── Daemon process subsection state ─────────────────────────────────
	const activeIsLocal = $derived(settingsStore.activeServer?.isLocal === true);

	let daemonStatus = $state<DaemonLifecycleStatus>('unknown');
	let isStarting = $state(false);
	let isStopping = $state(false);
	let actionError = $state<string | null>(null);
	let autoStart = $state(settingsStore.autoStartDaemon);
	let configIsPlaceholder = $state(false);

	onMount(async () => {
		try {
			daemonStatus = await daemonLifecycle.getDaemonStatus();
			const config = await configService.readConfig();
			configIsPlaceholder =
				!config?.providers?.length ||
				config.providers.every((p) => p.apiKey === '');
		} catch {
			// Silent — status will remain 'unknown' if the daemon process API is unavailable
		}
	});

	$effect(() => {
		// Sync `autoStart` if the underlying setting changes from outside this view.
		autoStart = settingsStore.autoStartDaemon;
	});

	$effect(() => {
		if (connectionStore.isConnected && activeIsLocal) {
			daemonStatus = 'running';
		}
	});

	async function handleStart(): Promise<void> {
		isStarting = true;
		actionError = null;
		try {
			await daemonLifecycle.startDaemon();
			await new Promise<void>((r) => setTimeout(r, 2000));
			daemonStatus = await daemonLifecycle.getDaemonStatus();
			if (daemonStatus === 'running') {
				await connectionStore.checkNow();
			}
		} catch (error) {
			actionError =
				error instanceof Error ? error.message : 'Failed to start daemon';
			daemonStatus = 'stopped';
		} finally {
			isStarting = false;
		}
	}

	async function handleStop(): Promise<void> {
		isStopping = true;
		actionError = null;
		try {
			await daemonLifecycle.stopDaemon();
			await new Promise<void>((r) => setTimeout(r, 1000));
			daemonStatus = 'stopped';
			await connectionStore.checkNow();
		} catch (error) {
			actionError =
				error instanceof Error ? error.message : 'Failed to stop daemon';
			daemonStatus = await daemonLifecycle.getDaemonStatus();
		} finally {
			isStopping = false;
		}
	}

	async function handleAutoStartToggle(): Promise<void> {
		autoStart = !autoStart;
		await settingsStore.setAutoStartDaemon(autoStart);
	}

	const statusColor = $derived(
		daemonStatus === 'running'
			? 'var(--color-success)'
			: daemonStatus === 'starting' || daemonStatus === 'stopping'
				? 'var(--color-warning)'
				: daemonStatus === 'stopped'
					? 'var(--color-error)'
					: 'var(--text-disabled)',
	);

	const statusLabel = $derived(
		daemonStatus === 'running'
			? 'Running'
			: daemonStatus === 'starting'
				? 'Starting…'
				: daemonStatus === 'stopping'
					? 'Stopping…'
					: daemonStatus === 'stopped'
						? configIsPlaceholder
							? 'Stopped — needs API key'
							: 'Stopped'
						: 'Unknown',
	);
</script>

<div class="servers-settings">
	<header class="settings-section-header">
		<h3 class="section-title">Servers</h3>
		<p class="section-desc">
			Manage daemon connections. Switch between local and remote servers anytime.
		</p>
	</header>

	{#if saveError}
		<div class="error-message" role="alert">
			<span class="error-icon" aria-hidden="true">
				<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
			</span>
			{saveError}
		</div>
	{/if}

	<section class="server-card">
		<ServerList
			servers={settingsStore.servers}
			{statuses}
			activeId={settingsStore.activeServerId}
			onSelect={handleSelect}
			onEdit={openEditModal}
			onRemove={handleRemove}
			onSetDefault={handleSetDefault}
			onAdd={openAddModal}
		/>
	</section>

	{#if activeIsLocal}
		<header class="settings-section-header">
			<h3 class="section-title">Daemon process</h3>
			<p class="section-desc">
				Start, stop, and auto-launch the local daemon process.
			</p>
		</header>

		<section class="daemon-card">
			<div class="status-row">
				<div class="status-indicator">
					<span
						class="status-dot"
						style="background-color: {statusColor};"
						aria-hidden="true"
					></span>
					<span class="status-label">{statusLabel}</span>
				</div>
				<div class="control-buttons">
					<button
						class="btn-control start"
						onclick={handleStart}
						disabled={daemonStatus === 'running' || isStarting || isStopping}
						aria-label="Start daemon"
					>
						{isStarting ? 'Starting…' : 'Start'}
					</button>
					<button
						class="btn-control stop"
						onclick={handleStop}
						disabled={daemonStatus !== 'running' || isStarting || isStopping}
						aria-label="Stop daemon"
					>
						{isStopping ? 'Stopping…' : 'Stop'}
					</button>
				</div>
			</div>

			{#if configIsPlaceholder}
				<div class="info-message" role="note">
					<span aria-hidden="true">ℹ</span>
					No API key configured. Go to
					<button
						class="inline-link"
						onclick={() => navigationStore.navigate('settings')}
					>Providers</button>
					and add one, then start the daemon.
				</div>
			{/if}

			{#if actionError}
				<div class="error-message" role="alert">
					<span class="error-icon" aria-hidden="true">
						<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
					</span>
					{actionError}
				</div>
			{/if}

			<!-- Auto-start toggle is desktop-only. Mobile (Capacitor) is
			     remote-only per MH7 — there is no embedded daemon to
			     start — so this control is hidden rather than disabled
			     to keep the settings surface honest about what the
			     platform actually supports. -->
			{#if !isCapacitorRuntime}
				<div class="auto-start-row">
					<div class="auto-start-info">
						<span class="auto-start-label">Auto-start on launch</span>
						<span class="auto-start-desc">
							Automatically start the local daemon when Elefant opens.
						</span>
					</div>
					<button
						class="toggle-switch"
						class:enabled={autoStart}
						onclick={handleAutoStartToggle}
						role="switch"
						aria-checked={autoStart}
						aria-label="Auto-start daemon on launch"
					>
						<span class="toggle-thumb"></span>
					</button>
				</div>
			{/if}
		</section>
	{/if}

	<AddEditServerModal
		open={modalOpen}
		server={editingServer}
		onSave={handleModalSave}
		onCancel={closeModal}
	/>
</div>

<style>
	.servers-settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 720px;
	}

	.settings-section-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.section-title {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.section-desc {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-meta);
	}

	.server-card {
		background-color: var(--surface-plate);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.daemon-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background-color: var(--surface-plate);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
	}

	.status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.status-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
		transition: background-color var(--transition-base);
	}

	.status-label {
		font-size: var(--font-size-sm);
		color: var(--text-prose);
		font-weight: 500;
	}

	.control-buttons {
		display: flex;
		gap: var(--space-2);
	}

	.btn-control {
		min-height: 36px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base),
			border-color var(--transition-base),
			opacity var(--transition-base);
	}

	.btn-control.start {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: 1px solid var(--color-primary);
	}

	.btn-control.start:hover:not(:disabled),
	.btn-control.start:focus-visible:not(:disabled) {
		background-color: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		outline: none;
	}

	.btn-control.stop {
		background-color: transparent;
		color: var(--text-meta);
		border: 1px solid var(--border-edge);
	}

	.btn-control.stop:hover:not(:disabled),
	.btn-control.stop:focus-visible:not(:disabled) {
		color: var(--color-error);
		border-color: var(--color-error);
		outline: none;
	}

	.btn-control:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.info-message {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		color: var(--text-meta);
		line-height: 1.5;
	}

	.inline-link {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-primary);
		cursor: pointer;
		font-size: inherit;
		font-family: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.inline-link:hover,
	.inline-link:focus-visible {
		color: var(--color-primary-hover);
		outline: none;
	}

	.error-message {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: rgba(239, 68, 68, 0.10);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		color: var(--color-error);
		line-height: 1.5;
	}

	.error-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.auto-start-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-hairline);
	}

	.auto-start-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.auto-start-label {
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--text-prose);
	}

	.auto-start-desc {
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	.toggle-switch {
		width: 44px;
		height: 24px;
		border-radius: var(--radius-full);
		background-color: var(--border-edge);
		border: none;
		cursor: pointer;
		position: relative;
		transition: background-color var(--transition-base);
		flex-shrink: 0;
		padding: 0;
	}

	.toggle-switch.enabled {
		background-color: var(--color-primary);
	}

	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background-color: #ffffff;
		transition: transform var(--transition-base);
		display: block;
	}

	.toggle-switch.enabled .toggle-thumb {
		transform: translateX(20px);
	}

	@media (max-width: 640px) {
		.btn-control {
			min-height: 44px;
		}

		.toggle-switch {
			min-height: 44px;
			height: 28px;
			width: 52px;
		}

		.toggle-thumb {
			width: 24px;
			height: 24px;
			top: 2px;
		}

		.toggle-switch.enabled .toggle-thumb {
			transform: translateX(24px);
		}
	}
</style>
