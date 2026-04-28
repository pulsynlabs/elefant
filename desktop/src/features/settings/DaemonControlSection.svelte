<script lang="ts">
	import { onMount } from 'svelte';
	import {
		daemonLifecycle,
		type DaemonLifecycleStatus,
	} from '$lib/services/daemon-lifecycle.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { connectionStore } from '$lib/stores/connection.svelte.js';
	import { configService } from '$lib/services/config-service.js';
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import { HugeiconsIcon, WarningIcon } from '$lib/icons/index.js';

	let daemonStatus = $state<DaemonLifecycleStatus>('unknown');
	let isStarting = $state(false);
	let isStopping = $state(false);
	let actionError = $state<string | null>(null);
	let autoStart = $state(settingsStore.autoStartDaemon);
	let configIsPlaceholder = $state(false);

	onMount(async () => {
		daemonStatus = await daemonLifecycle.getDaemonStatus();
		const config = await configService.readConfig();
		// Masked keys are '••••••••' when real, '' when unconfigured
		configIsPlaceholder =
			!config?.providers?.length ||
			config.providers.every((p) => p.apiKey === '');
	});

	$effect(() => {
		if (connectionStore.isConnected) {
			daemonStatus = 'running';
		}
	});

	async function handleStart(): Promise<void> {
		isStarting = true;
		actionError = null;
		try {
			await daemonLifecycle.startDaemon();
			await new Promise<void>(r => setTimeout(r, 2000));
			daemonStatus = await daemonLifecycle.getDaemonStatus();
			if (daemonStatus === 'running') {
				await connectionStore.checkNow();
			}
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
			await new Promise<void>(r => setTimeout(r, 1000));
			daemonStatus = 'stopped';
			await connectionStore.checkNow();
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'Failed to stop daemon';
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
					: 'var(--color-text-disabled)',
	);

	const statusLabel = $derived(
		daemonStatus === 'running'
			? 'Running'
			: daemonStatus === 'starting'
				? 'Starting...'
				: daemonStatus === 'stopping'
					? 'Stopping...'
					: daemonStatus === 'stopped'
						? configIsPlaceholder
							? 'Stopped — needs API key'
							: 'Stopped'
						: 'Unknown',
	);
</script>

<div class="daemon-section">
	<h3 class="section-heading">Daemon Control</h3>
	<p class="section-desc">
		Manage the Elefant daemon process that powers the AI agent backend.
	</p>

	<div class="status-card">
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
					{isStarting ? 'Starting...' : 'Start'}
				</button>
				<button
					class="btn-control stop"
					onclick={handleStop}
					disabled={daemonStatus !== 'running' || isStarting || isStopping}
					aria-label="Stop daemon"
				>
					{isStopping ? 'Stopping...' : 'Stop'}
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
	</div>

	<div class="auto-start-row">
		<div class="auto-start-info">
			<span class="auto-start-label">Auto-start on launch</span>
			<span class="auto-start-desc"
				>Automatically start the daemon when Elefant opens.</span
			>
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
</div>

<style>
	.daemon-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 520px;
	}

	.section-heading {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.section-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-top: calc(-1 * var(--space-2));
	}

	.status-card {
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
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
		font-size: var(--font-size-md);
		color: var(--color-text-primary);
		font-weight: var(--font-weight-medium);
	}

	.control-buttons {
		display: flex;
		gap: var(--space-2);
	}

	.btn-control {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			opacity var(--transition-fast);
	}

	.btn-control.start {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
	}

	.btn-control.start:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
	}

	.btn-control.stop {
		background-color: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.btn-control.stop:hover:not(:disabled) {
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.btn-control:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.info-message {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		padding: var(--space-2) var(--space-3);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		line-height: var(--line-height-base);
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

	.inline-link:hover {
		color: var(--color-primary-hover);
	}

	.error-message {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--color-error);
		padding: var(--space-2) var(--space-3);
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-error) 25%, transparent);
		border-radius: var(--radius-md);
		line-height: var(--line-height-base);
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
		padding: var(--space-4);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.auto-start-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.auto-start-label {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
	}

	.auto-start-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.toggle-switch {
		width: 44px;
		height: 24px;
		border-radius: var(--radius-full);
		background-color: var(--color-border-strong);
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
		background-color: white;
		transition: transform var(--transition-base);
		display: block;
	}

	.toggle-switch.enabled .toggle-thumb {
		transform: translateX(20px);
	}
</style>
