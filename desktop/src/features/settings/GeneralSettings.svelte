<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { configService } from '$lib/services/config-service.js';
	import type { LogLevel } from '$lib/daemon/types.js';
	import { onMount } from 'svelte';
	import NumberInput from '$lib/components/ui/NumberInput.svelte';
	import SelectInput from '$lib/components/ui/SelectInput.svelte';
	import { HugeiconsIcon, RefreshIcon } from '$lib/icons/index.js';

	let daemonUrl = $state(settingsStore.daemonUrl);
	let port = $state(1337);
	let logLevel = $state<LogLevel>('info');
	let defaultProvider = $state('');
	let availableProviders = $state<string[]>([]);
	let hardwareAcceleration = $state<'enabled' | 'disabled'>('enabled');
	let savedHardwareAcceleration = $state<'enabled' | 'disabled'>('enabled');
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveMessage = $state('');
	let restartStatus = $state<'idle' | 'restarting'>('idle');

	const logLevelOptions = [
		{ value: 'debug', label: 'Debug' },
		{ value: 'info', label: 'Info' },
		{ value: 'warn', label: 'Warn' },
		{ value: 'error', label: 'Error' },
	];

	const hardwareAccelerationOptions = [
		{ value: 'enabled', label: 'Enabled (default)' },
		{ value: 'disabled', label: 'Disabled (Windows only, restart required)' },
	];

	const providerOptions = $derived(
		availableProviders.map((p) => ({ value: p, label: p }))
	);

	const restartRequired = $derived(hardwareAcceleration !== savedHardwareAcceleration);

	onMount(async () => {
		const config = await configService.readConfig();
		if (config) {
			port = config.port;
			logLevel = config.logLevel;
			defaultProvider = config.defaultProvider;
			availableProviders = config.providers.map(p => p.name);
			const isDisabled = config.hardwareAccelerationDisabled ?? false;
			hardwareAcceleration = isDisabled ? 'disabled' : 'enabled';
			savedHardwareAcceleration = hardwareAcceleration;
		}
	});

	async function handleSave(): Promise<void> {
		saveStatus = 'saving';
		try {
			await settingsStore.setDaemonUrl(daemonUrl);
			await configService.updateConfig({
				port,
				logLevel,
				...(defaultProvider ? { defaultProvider } : {}),
				hardwareAccelerationDisabled: hardwareAcceleration === 'disabled',
			});

			savedHardwareAcceleration = hardwareAcceleration;
			saveStatus = 'saved';
			saveMessage = 'Settings saved';
			setTimeout(() => { saveStatus = 'idle'; }, 2000);
		} catch (error) {
			saveStatus = 'error';
			saveMessage = error instanceof Error ? error.message : 'Failed to save settings';
			setTimeout(() => { saveStatus = 'idle'; }, 4000);
		}
	}

	async function handleRestart(): Promise<void> {
		restartStatus = 'restarting';
		try {
			// Invoke the Tauri restart command
			await (window as any).__TAURI__.invoke('restart_app');
		} catch {
			restartStatus = 'idle';
		}
	}
</script>

<div class="general-settings">
	<h3 class="section-heading">General</h3>

	<div class="form-group">
		<label class="field-label" for="daemonUrl">Daemon URL</label>
		<input
			id="daemonUrl"
			type="url"
			class="field-input"
			bind:value={daemonUrl}
			placeholder="http://localhost:1337"
			aria-describedby="daemonUrl-hint"
		/>
		<span id="daemonUrl-hint" class="field-hint"
			>The URL where the Elefant daemon is running</span
		>
	</div>

	<div class="form-group">
		<label class="field-label" for="port">Daemon Port</label>
		<NumberInput id="port" bind:value={port} min={1} max={65535} />
		<span class="field-hint">Written to elefant.config.json. Requires daemon restart.</span>
	</div>

	{#if availableProviders.length > 0}
		<div class="form-group">
			<label class="field-label" for="defaultProvider">Default Provider</label>
			<SelectInput id="defaultProvider" bind:value={defaultProvider} options={providerOptions} />
		</div>
	{/if}

	<div class="form-group">
		<label class="field-label" for="logLevel">Log Level</label>
		<SelectInput id="logLevel" bind:value={logLevel} options={logLevelOptions} />
		<span class="field-hint">Written to elefant.config.json. Requires daemon restart.</span>
	</div>

	<div class="form-group">
		<label class="field-label" for="hardwareAcceleration">Hardware Acceleration</label>
		<SelectInput
			id="hardwareAcceleration"
			bind:value={hardwareAcceleration}
			options={hardwareAccelerationOptions}
		/>
		<span class="field-hint">
			Disable GPU acceleration on Windows if you experience rendering issues. Restart required after saving.
		</span>
		{#if restartRequired}
			<div class="restart-notice">
				<span class="restart-text">Restart required to apply changes</span>
			</div>
		{/if}
	</div>

	<div class="form-actions">
		<button class="btn-primary" onclick={handleSave} disabled={saveStatus === 'saving'}>
			{saveStatus === 'saving' ? 'Saving...' : 'Save Changes'}
		</button>
		{#if restartRequired}
			<button
				class="btn-secondary"
				onclick={handleRestart}
				disabled={restartStatus === 'restarting'}
			>
				<span class="btn-icon" aria-hidden="true">
					<HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.8} />
				</span>
				{restartStatus === 'restarting' ? 'Restarting...' : 'Restart Elefant'}
			</button>
		{/if}
		{#if saveStatus !== 'idle'}
			<span class="save-feedback" class:error={saveStatus === 'error'}>
				{saveMessage}
			</span>
		{/if}
	</div>
</div>

<style>
	.general-settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 520px;
	}

	.section-heading {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		margin-bottom: var(--space-2);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.field-label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
	}

	.field-input {
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		padding: var(--space-2) var(--space-3);
		width: 100%;
		outline: none;
		transition: border-color var(--transition-fast);
	}

	.field-input:focus {
		border-color: var(--color-primary);
	}

	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
	}

	.form-actions {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-top: var(--space-2);
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-5);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			opacity var(--transition-fast);
	}

	.btn-primary:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* ── Mobile touch targets (≥44px) ─────────────────────────────── */
	@media (max-width: 640px) {
		.btn-primary,
		.btn-secondary {
			min-height: 44px;
		}
	}

	.save-feedback {
		font-size: var(--font-size-sm);
		color: var(--color-success);
	}

	.save-feedback.error {
		color: var(--color-error);
	}

	.restart-notice {
		margin-top: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: var(--color-primary-subtle);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-md);
	}

	.restart-text {
		font-size: var(--font-size-sm);
		color: var(--color-primary);
		font-weight: var(--font-weight-medium);
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background-color: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast);
	}

	.btn-secondary:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
		color: var(--color-text-primary);
	}

	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
</style>
