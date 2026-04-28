<script lang="ts">
	// DaemonPopover — floating daemon management panel triggered from the
	// "Connected / Disconnected" button in the TopBar.
	//
	// Provides: status indicator, Restart (primary action), Start, Stop.
	// Restart = stop then start, used to pick up daemon code changes without
	// navigating to Settings → Daemon.
	//
	// Closed by: clicking outside, pressing Escape, or the parent toggling
	// the `open` prop. Uses a portal-style fixed overlay so it always floats
	// above all content regardless of stacking context.

	import { onMount } from 'svelte';
	import { daemonLifecycle, type DaemonLifecycleStatus } from '$lib/services/daemon-lifecycle.js';
	import { connectionStore } from '$lib/stores/connection.svelte.js';
	import { HugeiconsIcon, WarningIcon, CloseIcon } from '$lib/icons/index.js';

	type Props = {
		open: boolean;
		onClose: () => void;
		/** Anchor element ref — used to position the popover below the trigger. */
		anchorEl?: HTMLElement | null;
	};

	let { open, onClose, anchorEl = null }: Props = $props();

	let daemonStatus = $state<DaemonLifecycleStatus>('unknown');
	let isStarting = $state(false);
	let isStopping = $state(false);
	let isRestarting = $state(false);
	let actionError = $state<string | null>(null);
	let popoverEl = $state<HTMLDivElement | null>(null);

	// Sync daemon status with connection store
	$effect(() => {
		if (connectionStore.isConnected) {
			daemonStatus = 'running';
		}
	});

	// Refresh daemon status whenever popover opens
	$effect(() => {
		if (open) {
			actionError = null;
			void daemonLifecycle.getDaemonStatus().then((s) => {
				daemonStatus = s;
			});
		}
	});

	// Close on Escape
	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') onClose();
	}

	// Close on outside click
	function handleDocumentClick(e: MouseEvent): void {
		if (!popoverEl) return;
		if (anchorEl && anchorEl.contains(e.target as Node)) return;
		if (!popoverEl.contains(e.target as Node)) onClose();
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeydown);
		document.addEventListener('mousedown', handleDocumentClick, true);
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('mousedown', handleDocumentClick, true);
		};
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
			actionError = error instanceof Error ? error.message : 'Failed to start daemon';
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
			actionError = error instanceof Error ? error.message : 'Failed to stop daemon';
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
			actionError = error instanceof Error ? error.message : 'Failed to restart daemon';
			daemonStatus = await daemonLifecycle.getDaemonStatus();
		} finally {
			isRestarting = false;
		}
	}

	const isBusy = $derived(isStarting || isStopping || isRestarting);

	const statusDotColor = $derived(
		daemonStatus === 'running'
			? 'var(--color-success, #10b981)'
			: daemonStatus === 'starting' || daemonStatus === 'stopping'
				? 'var(--color-warning, #d97706)'
				: daemonStatus === 'stopped'
					? 'var(--color-error, #ef4444)'
					: 'var(--color-text-disabled)',
	);

	const statusLabel = $derived(
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
</script>

{#if open}
	<div
		class="popover"
		bind:this={popoverEl}
		role="dialog"
		aria-label="Daemon management"
		aria-modal="false"
	>
		<!-- Header -->
		<div class="popover-header">
			<span class="popover-title mono-label">Daemon</span>
			<button
				class="close-btn"
				onclick={onClose}
				aria-label="Close daemon panel"
				type="button"
			>
				<HugeiconsIcon icon={CloseIcon} size={14} strokeWidth={1.5} />
			</button>
		</div>

		<!-- Status row -->
		<div class="status-row">
			<span
				class="status-dot"
				style="background-color: {statusDotColor};"
				aria-hidden="true"
			></span>
			<span class="status-label">{statusLabel}</span>
		</div>

		<!-- Action buttons -->
		<div class="actions">
			<button
				class="btn btn-restart"
				onclick={handleRestart}
				disabled={isBusy}
				type="button"
				aria-label="Restart daemon"
			>
				{isRestarting ? 'Restarting…' : 'Restart'}
			</button>
			<button
				class="btn btn-start"
				onclick={handleStart}
				disabled={isBusy || daemonStatus === 'running'}
				type="button"
				aria-label="Start daemon"
			>
				{isStarting ? 'Starting…' : 'Start'}
			</button>
			<button
				class="btn btn-stop"
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
					<HugeiconsIcon icon={WarningIcon} size={13} strokeWidth={1.5} />
				</span>
				<span class="error-text">{actionError}</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.popover {
		position: fixed;
		/* Positioned via JS anchor or falls back to top-right corner */
		top: calc(var(--topbar-height, 44px) + var(--space-2));
		right: var(--space-4);
		z-index: var(--z-modal);
		width: 240px;
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.16);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		/* Subtle glass surface */
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	/* ── Header ─────────────────────────────────────────────────────── */
	.popover-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.popover-title {
		font-size: var(--font-size-2xs);
		font-family: var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-disabled);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: var(--radius-sm);
		padding: 0;
		transition: color var(--duration-fast) var(--ease-out-expo),
			background-color var(--duration-fast) var(--ease-out-expo);
	}

	.close-btn:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	/* ── Status ─────────────────────────────────────────────────────── */
	.status-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-1);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		transition: background-color var(--transition-base);
	}

	.status-label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
	}

	/* ── Buttons ─────────────────────────────────────────────────────── */
	.actions {
		display: flex;
		gap: var(--space-2);
	}

	.btn {
		flex: 1;
		padding: var(--space-2) 0;
		border-radius: var(--radius-md);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			opacity var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* Restart — primary, always available */
	.btn-restart {
		background-color: var(--color-primary);
		color: #fff;
		border: none;
	}

	.btn-restart:hover:not(:disabled) {
		background-color: var(--color-primary-hover, color-mix(in srgb, var(--color-primary) 80%, black));
	}

	/* Start — ghost */
	.btn-start {
		background-color: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.btn-start:hover:not(:disabled) {
		color: var(--color-success, #10b981);
		border-color: var(--color-success, #10b981);
	}

	/* Stop — ghost destructive */
	.btn-stop {
		background-color: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.btn-stop:hover:not(:disabled) {
		color: var(--color-error, #ef4444);
		border-color: var(--color-error, #ef4444);
	}

	/* ── Error ───────────────────────────────────────────────────────── */
	.error-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2);
		background-color: color-mix(in oklch, var(--color-error, #ef4444) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-error, #ef4444) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.error-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--color-error, #ef4444);
	}

	.error-text {
		font-size: var(--font-size-xs);
		color: var(--color-error, #ef4444);
		line-height: var(--line-height-relaxed);
		word-break: break-word;
	}
</style>
