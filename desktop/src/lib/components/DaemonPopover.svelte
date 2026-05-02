<script lang="ts">
	// DaemonPopover — quick server switcher.
	//
	// Lists every configured daemon server with live health status, lets
	// the user switch the active server with a single click, and (only when
	// the active server is a local sidecar) exposes daemon lifecycle
	// controls below the list.
	//
	// Closed by: clicking outside, pressing Escape, or the parent toggling
	// the `open` prop. Anchored below the trigger element on desktop;
	// rendered as a full-width bottom sheet on mobile (≤640px).

	import { onMount } from 'svelte';
	import {
		daemonLifecycle,
		type DaemonLifecycleStatus,
	} from '$lib/services/daemon-lifecycle.js';
	import { connectionStore } from '$lib/stores/connection.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { registry, type RegistryHealthEntry } from '$lib/daemon/registry.js';
	import type { ServerConfig, ServerHealthStatus } from '$lib/types/server.js';
	import {
		HugeiconsIcon,
		WarningIcon,
		CloseIcon,
		CheckIcon,
		ChevronRightIcon,
	} from '$lib/icons/index.js';

	type Props = {
		open: boolean;
		onClose: () => void;
		/** Anchor element ref — used to position the popover below the trigger. */
		anchorEl?: HTMLElement | null;
		/** Optional callback invoked when the user clicks "Manage servers". */
		onManageServers?: () => void;
	};

	let {
		open,
		onClose,
		anchorEl = null,
		onManageServers,
	}: Props = $props();

	// ── Per-server health (mirrored from the registry) ────────────────────
	let serverStatuses = $state<Record<string, RegistryHealthEntry>>({});

	// Seed and subscribe to registry status updates while the popover may
	// open. We keep the subscription mounted for the lifetime of the
	// component so opening the popover never has stale data.
	function seedStatuses(): void {
		const next: Record<string, RegistryHealthEntry> = {};
		for (const server of settingsStore.servers) {
			next[server.id] = registry.getStatus(server.id);
		}
		serverStatuses = next;
	}

	let unsubscribeRegistry: (() => void) | null = null;

	onMount(() => {
		seedStatuses();
		unsubscribeRegistry = registry.subscribe((serverId, entry) => {
			serverStatuses = { ...serverStatuses, [serverId]: entry };
		});
		document.addEventListener('keydown', handleKeydown);
		document.addEventListener('mousedown', handleDocumentClick, true);
		return () => {
			unsubscribeRegistry?.();
			unsubscribeRegistry = null;
			document.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('mousedown', handleDocumentClick, true);
		};
	});

	// Re-seed when the configured server list changes (add/remove).
	$effect(() => {
		// Track length so we re-seed on add/remove.
		void settingsStore.servers.length;
		seedStatuses();
	});

	// ── Derived state ─────────────────────────────────────────────────────
	const activeServer = $derived(settingsStore.activeServer);
	const isLocalActive = $derived(activeServer?.isLocal === true);

	function statusFor(server: ServerConfig): ServerHealthStatus {
		return serverStatuses[server.id]?.status ?? 'unknown';
	}

	function latencyFor(server: ServerConfig): number | null {
		return serverStatuses[server.id]?.latencyMs ?? null;
	}

	function statusDotColor(status: ServerHealthStatus): string {
		return status === 'connected'
			? 'var(--color-success)'
			: status === 'reconnecting'
				? 'var(--color-warning)'
				: status === 'disconnected'
					? 'var(--color-error)'
					: 'var(--text-disabled)';
	}

	function statusText(server: ServerConfig): string {
		const s = statusFor(server);
		const latency = latencyFor(server);
		if (s === 'connected') {
			return latency != null ? `Connected · ${latency}ms` : 'Connected';
		}
		if (s === 'reconnecting') return 'Reconnecting…';
		if (s === 'disconnected') return 'Disconnected';
		return 'Unknown';
	}

	// ── Server switching ──────────────────────────────────────────────────
	let switchingId = $state<string | null>(null);

	async function handleSelectServer(server: ServerConfig): Promise<void> {
		if (server.id === activeServer?.id) return;
		switchingId = server.id;
		try {
			// Ensure the registry knows about this server (in case it was
			// added in another window/process and not yet polled).
			if (!registry.get(server.id)) {
				registry.register(server);
			}
			registry.setActive(server.id);
			await settingsStore.setActiveServer(server.id);
			onClose();
		} finally {
			switchingId = null;
		}
	}

	function handleManageServers(): void {
		onClose();
		onManageServers?.();
	}

	// ── Daemon lifecycle controls (only used when active server isLocal) ──
	let daemonStatus = $state<DaemonLifecycleStatus>('unknown');
	let isStarting = $state(false);
	let isStopping = $state(false);
	let isRestarting = $state(false);
	let actionError = $state<string | null>(null);

	$effect(() => {
		if (connectionStore.isConnected && isLocalActive) {
			daemonStatus = 'running';
		}
	});

	$effect(() => {
		if (open && isLocalActive) {
			actionError = null;
			void daemonLifecycle.getDaemonStatus().then((s) => {
				daemonStatus = s;
			});
		}
	});

	async function handleStart(): Promise<void> {
		isStarting = true;
		actionError = null;
		try {
			await daemonLifecycle.startDaemon();
			await new Promise<void>((r) => setTimeout(r, 2000));
			daemonStatus = await daemonLifecycle.getDaemonStatus();
			if (daemonStatus === 'running') await connectionStore.checkNow();
		} catch (error) {
			actionError =
				error instanceof Error
					? error.message
					: 'Failed to start daemon';
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
				error instanceof Error
					? error.message
					: 'Failed to stop daemon';
			daemonStatus = await daemonLifecycle.getDaemonStatus();
		} finally {
			isStopping = false;
		}
	}

	async function handleRestart(): Promise<void> {
		isRestarting = true;
		actionError = null;
		daemonStatus = 'stopping';
		try {
			await daemonLifecycle.restartDaemon();
			await new Promise<void>((r) => setTimeout(r, 2000));
			daemonStatus = await daemonLifecycle.getDaemonStatus();
			if (daemonStatus === 'running') await connectionStore.checkNow();
		} catch (error) {
			actionError =
				error instanceof Error
					? error.message
					: 'Failed to restart daemon';
			daemonStatus = await daemonLifecycle.getDaemonStatus();
		} finally {
			isRestarting = false;
		}
	}

	const isBusy = $derived(isStarting || isStopping || isRestarting);

	const lifecycleDotColor = $derived(
		daemonStatus === 'running'
			? 'var(--color-success)'
			: daemonStatus === 'starting' || daemonStatus === 'stopping'
				? 'var(--color-warning)'
				: daemonStatus === 'stopped'
					? 'var(--color-error)'
					: 'var(--text-disabled)',
	);

	const lifecycleLabel = $derived(
		daemonStatus === 'running'
			? 'Running'
			: daemonStatus === 'starting'
				? 'Starting…'
				: daemonStatus === 'stopping'
					? 'Stopping…'
					: daemonStatus === 'stopped'
						? 'Stopped'
						: 'Unknown',
	);

	// ── Close behavior ────────────────────────────────────────────────────
	let popoverEl = $state<HTMLDivElement | null>(null);

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && open) onClose();
	}

	function handleDocumentClick(e: MouseEvent): void {
		if (!open) return;
		if (!popoverEl) return;
		if (anchorEl && anchorEl.contains(e.target as Node)) return;
		if (!popoverEl.contains(e.target as Node)) onClose();
	}

	function handleBackdropClick(): void {
		onClose();
	}
</script>

{#if open}
	<!-- Mobile-only backdrop. Desktop keeps the existing
	     outside-click handler instead of a backdrop. -->
	<button
		class="mobile-backdrop"
		type="button"
		aria-label="Close server menu"
		onclick={handleBackdropClick}
	></button>

	<div
		class="popover"
		bind:this={popoverEl}
		role="dialog"
		aria-label="Server selector"
		aria-modal="false"
	>
		<!-- Header ─────────────────────────────────────────────────── -->
		<div class="popover-header">
			<span class="popover-title mono-label">Servers</span>
			<button
				class="close-btn"
				onclick={onClose}
				aria-label="Close server selector"
				type="button"
			>
				<HugeiconsIcon icon={CloseIcon} size={14} strokeWidth={1.5} />
			</button>
		</div>

		<!-- Server list ─────────────────────────────────────────────── -->
		<ul class="server-list" role="list">
			{#each settingsStore.servers as server (server.id)}
				{@const isActive = activeServer?.id === server.id}
				{@const status = statusFor(server)}
				<li class="server-item">
					<button
						class="server-entry"
						class:active={isActive}
						class:switching={switchingId === server.id}
						type="button"
						onclick={() => handleSelectServer(server)}
						disabled={switchingId !== null}
						aria-label={`Switch to ${server.displayName} (${statusText(server)})`}
						aria-current={isActive ? 'true' : undefined}
					>
						<span
							class="entry-dot"
							style="background-color: {statusDotColor(status)};"
							aria-hidden="true"
						></span>
						<div class="entry-text">
							<div class="entry-row-top">
								<span
									class="entry-name"
									class:active-name={isActive}
									title={server.displayName}
								>
									{server.displayName}
								</span>
								<span
									class="entry-url"
									title={server.url}
								>
									{server.url}
								</span>
							</div>
							<span class="entry-status">{statusText(server)}</span>
						</div>
						{#if isActive}
							<span class="entry-check" aria-hidden="true">
								<HugeiconsIcon
									icon={CheckIcon}
									size={14}
									strokeWidth={2}
								/>
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>

		<!-- Manage servers footer link ─────────────────────────────── -->
		<button
			class="manage-link"
			type="button"
			onclick={handleManageServers}
		>
			<span>Manage servers</span>
			<HugeiconsIcon
				icon={ChevronRightIcon}
				size={12}
				strokeWidth={1.5}
			/>
		</button>

		<!-- Local daemon controls (only when active server is local) ── -->
		{#if isLocalActive}
			<div class="lifecycle-section">
				<div class="lifecycle-header">
					<span class="lifecycle-label mono-label">Local daemon</span>
					<span class="lifecycle-status">
						<span
							class="lifecycle-dot"
							style="background-color: {lifecycleDotColor};"
							aria-hidden="true"
						></span>
						<span class="lifecycle-status-text">{lifecycleLabel}</span>
					</span>
				</div>

				<div class="lifecycle-actions">
					<button
						class="lifecycle-btn primary"
						onclick={handleRestart}
						disabled={isBusy}
						type="button"
						aria-label="Restart daemon"
					>
						{isRestarting ? 'Restarting…' : 'Restart'}
					</button>
					<button
						class="lifecycle-btn ghost"
						onclick={handleStart}
						disabled={isBusy || daemonStatus === 'running'}
						type="button"
						aria-label="Start daemon"
					>
						{isStarting ? 'Starting…' : 'Start'}
					</button>
					<button
						class="lifecycle-btn ghost destructive"
						onclick={handleStop}
						disabled={isBusy || daemonStatus !== 'running'}
						type="button"
						aria-label="Stop daemon"
					>
						{isStopping ? 'Stopping…' : 'Stop'}
					</button>
				</div>

				{#if actionError}
					<div class="error-row" role="alert">
						<span class="error-icon" aria-hidden="true">
							<HugeiconsIcon
								icon={WarningIcon}
								size={13}
								strokeWidth={1.5}
							/>
						</span>
						<span class="error-text">{actionError}</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Popover container ─────────────────────────────────────────── */
	.popover {
		position: fixed;
		top: calc(var(--topbar-height, 44px) + var(--space-2));
		right: var(--space-4);
		z-index: var(--z-modal);
		width: 320px;
		max-height: calc(100vh - var(--topbar-height, 44px) - var(--space-6));
		background-color: var(--surface-plate);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: popover-enter 120ms var(--ease-out-expo);
	}

	@keyframes popover-enter {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Mobile backdrop is invisible on desktop */
	.mobile-backdrop {
		display: none;
	}

	/* ── Header ────────────────────────────────────────────────────── */
	.popover-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border-hairline);
	}

	.popover-title {
		font-size: var(--font-size-2xs);
		font-family: var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.close-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		color: var(--text-meta);
		cursor: pointer;
		border-radius: var(--radius-sm);
		padding: 0;
		transition:
			color var(--duration-fast) var(--ease-out-expo),
			background-color var(--duration-fast) var(--ease-out-expo);
	}

	.close-btn:hover,
	.close-btn:focus-visible {
		color: var(--text-prose);
		background-color: var(--surface-hover);
		outline: none;
	}

	/* ── Server list ────────────────────────────────────────────────── */
	.server-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		max-height: 360px;
	}

	.server-item {
		display: block;
	}

	.server-item + .server-item .server-entry {
		border-top: 1px solid var(--border-hairline);
	}

	.server-entry {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 56px;
		padding: var(--space-3) var(--space-4);
		background-color: transparent;
		border: none;
		color: var(--text-prose);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--transition-base);
	}

	.server-entry:hover:not(.active):not(:disabled) {
		background-color: var(--surface-hover);
	}

	.server-entry:focus-visible {
		outline: 2px solid var(--border-focus);
		outline-offset: -2px;
	}

	.server-entry.active {
		background-color: var(--surface-leaf);
		cursor: default;
	}

	.server-entry.switching {
		opacity: 0.6;
	}

	.server-entry:disabled {
		cursor: not-allowed;
	}

	.entry-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		transition: background-color var(--transition-base);
	}

	.entry-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.entry-row-top {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}

	.entry-name {
		font-size: var(--font-size-sm);
		font-weight: 400;
		color: var(--text-prose);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 0 1 auto;
	}

	.entry-name.active-name {
		font-weight: 500;
	}

	.entry-url {
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1 1 auto;
	}

	.entry-status {
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	.entry-check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
		flex-shrink: 0;
	}

	/* ── Manage servers link ───────────────────────────────────────── */
	.manage-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 44px;
		padding: var(--space-3) var(--space-4);
		background-color: transparent;
		border: none;
		border-top: 1px solid var(--border-hairline);
		color: var(--text-meta);
		font-family: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base);
	}

	.manage-link:hover,
	.manage-link:focus-visible {
		background-color: var(--surface-hover);
		color: var(--text-prose);
		outline: none;
	}

	/* ── Local daemon lifecycle subsection ─────────────────────────── */
	.lifecycle-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4) var(--space-4);
		border-top: 1px solid var(--border-hairline);
		background-color: var(--surface-substrate);
	}

	.lifecycle-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.lifecycle-label {
		font-size: var(--font-size-2xs);
		font-family: var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.lifecycle-status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.lifecycle-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		transition: background-color var(--transition-base);
	}

	.lifecycle-status-text {
		font-size: var(--font-size-xs);
		color: var(--text-prose);
		font-weight: var(--font-weight-medium);
	}

	.lifecycle-actions {
		display: flex;
		gap: var(--space-2);
	}

	.lifecycle-btn {
		flex: 1;
		min-height: 36px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast),
			opacity var(--transition-fast),
			border-color var(--transition-fast);
	}

	.lifecycle-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.lifecycle-btn.primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: 1px solid var(--color-primary);
	}

	.lifecycle-btn.primary:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
	}

	.lifecycle-btn.ghost {
		background-color: transparent;
		color: var(--text-meta);
		border: 1px solid var(--border-edge);
	}

	.lifecycle-btn.ghost:hover:not(:disabled) {
		color: var(--color-success);
		border-color: var(--color-success);
	}

	.lifecycle-btn.ghost.destructive:hover:not(:disabled) {
		color: var(--color-error);
		border-color: var(--color-error);
	}

	/* ── Error row ─────────────────────────────────────────────────── */
	.error-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2);
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-error) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.error-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--color-error);
	}

	.error-text {
		font-size: var(--font-size-xs);
		color: var(--color-error);
		line-height: var(--line-height-relaxed);
		word-break: break-word;
	}

	/* ── Mobile bottom sheet (≤640px) ──────────────────────────────── */
	@media (max-width: 640px) {
		.mobile-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			z-index: calc(var(--z-modal) - 1);
			background-color: rgba(0, 0, 0, 0.4);
			border: none;
			padding: 0;
			margin: 0;
			cursor: default;
			animation: backdrop-enter 120ms var(--ease-out-expo);
		}

		@keyframes backdrop-enter {
			from {
				opacity: 0;
			}
			to {
				opacity: 1;
			}
		}

		.popover {
			top: auto;
			right: 0;
			bottom: 0;
			left: 0;
			width: 100%;
			max-height: 80vh;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			border-bottom: none;
			animation: sheet-enter 160ms var(--ease-out-expo);
		}

		@keyframes sheet-enter {
			from {
				opacity: 0;
				transform: translateY(16px);
			}
			to {
				opacity: 1;
				transform: translateY(0);
			}
		}

		.server-list {
			max-height: 50vh;
		}

		.server-entry {
			min-height: 64px;
		}

		.manage-link {
			min-height: 48px;
		}

		.lifecycle-btn {
			min-height: 44px;
		}

		.close-btn {
			width: 44px;
			height: 44px;
		}
	}
</style>
