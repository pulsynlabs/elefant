<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import { configService } from '$lib/services/config-service.js';
	import type { LogLevel } from '$lib/daemon/types.js';
	import { onMount } from 'svelte';

	let daemonUrl = $state(settingsStore.daemonUrl);
	let port = $state(1337);
	let logLevel = $state<LogLevel>('info');
	let defaultProvider = $state('');
	let availableProviders = $state<string[]>([]);
	// Compaction threshold is shown as an integer percentage (50–95) in the
	// UI but persisted as a decimal (0.5–0.95) on the daemon. Default to 80%
	// to match the daemon's `compactionThreshold` schema default of 0.8.
	let compactionThresholdPercent = $state(80);
	let compactionThresholdError = $state('');
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveMessage = $state('');

	onMount(async () => {
		const config = await configService.readConfig();
		if (config) {
			port = config.port;
			logLevel = config.logLevel;
			defaultProvider = config.defaultProvider;
			availableProviders = config.providers.map(p => p.name);
			// Daemon stores threshold as a decimal; surface it as a whole-number
			// percentage so users think in human-readable terms. Falls back to
			// the daemon-side default (0.8 → 80) when the field is unset.
			const decimal = config.compactionThreshold ?? 0.8;
			compactionThresholdPercent = Math.round(decimal * 100);
		}
	});

	function validateCompactionThreshold(): boolean {
		const value = compactionThresholdPercent;
		if (!Number.isFinite(value) || !Number.isInteger(value)) {
			compactionThresholdError = 'Enter a whole-number percentage between 50 and 95.';
			return false;
		}
		if (value < 50 || value > 95) {
			compactionThresholdError = `Threshold must be between 50 and 95.`;
			return false;
		}
		compactionThresholdError = '';
		return true;
	}

	async function handleSave(): Promise<void> {
		if (!validateCompactionThreshold()) {
			saveStatus = 'error';
			saveMessage = compactionThresholdError;
			setTimeout(() => { saveStatus = 'idle'; }, 4000);
			return;
		}
		saveStatus = 'saving';
		try {
			await settingsStore.setDaemonUrl(daemonUrl);
			// UI shows percentage; daemon stores decimal in [0.5, 0.95].
			// Round to 2 decimal places to avoid float artifacts like 0.7500000001.
			const compactionThreshold = Math.round(compactionThresholdPercent) / 100;
			await configService.updateConfig({
				port,
				logLevel,
				...(defaultProvider ? { defaultProvider } : {}),
				compactionThreshold,
			});

			saveStatus = 'saved';
			saveMessage = 'Settings saved';
			setTimeout(() => { saveStatus = 'idle'; }, 2000);
		} catch (error) {
			saveStatus = 'error';
			saveMessage = error instanceof Error ? error.message : 'Failed to save settings';
			setTimeout(() => { saveStatus = 'idle'; }, 4000);
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
		<input
			id="port"
			type="number"
			class="field-input field-input-narrow"
			bind:value={port}
			min="1"
			max="65535"
		/>
		<span class="field-hint">Written to elefant.config.json. Requires daemon restart.</span>
	</div>

	{#if availableProviders.length > 0}
		<div class="form-group">
			<label class="field-label" for="defaultProvider">Default Provider</label>
			<select id="defaultProvider" class="field-select" bind:value={defaultProvider}>
				{#each availableProviders as provider}
					<option value={provider}>{provider}</option>
				{/each}
			</select>
		</div>
	{/if}

	<div class="form-group">
		<label class="field-label" for="logLevel">Log Level</label>
		<select id="logLevel" class="field-select" bind:value={logLevel}>
			<option value="debug">Debug</option>
			<option value="info">Info</option>
			<option value="warn">Warn</option>
			<option value="error">Error</option>
		</select>
		<span class="field-hint">Written to elefant.config.json. Requires daemon restart.</span>
	</div>

	<div class="form-group">
		<label class="field-label" for="compactionThreshold">Context compaction threshold (%)</label>
		<input
			id="compactionThreshold"
			type="number"
			class="field-input field-input-narrow"
			bind:value={compactionThresholdPercent}
			min={50}
			max={95}
			step={1}
			aria-label="Context compaction threshold in percent"
		/>
		<span class="field-hint">
			When the conversation reaches this % of the context window, Elefant compacts older messages.
			Range: 50–95. Applied on the next compaction trigger — no restart required.
		</span>
		{#if compactionThresholdError}
			<span class="field-error" role="alert">{compactionThresholdError}</span>
		{/if}
	</div>

	<div class="form-actions">
		<button class="btn-primary" onclick={handleSave} disabled={saveStatus === 'saving'}>
			{saveStatus === 'saving' ? 'Saving...' : 'Save Changes'}
		</button>
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

	.field-input-narrow {
		max-width: 120px;
	}

	.field-select {
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		padding: var(--space-2) var(--space-3);
		outline: none;
		cursor: pointer;
		transition: border-color var(--transition-fast);
	}

	.field-select:focus {
		border-color: var(--color-primary);
	}

	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
	}

	.field-error {
		font-size: var(--font-size-xs);
		color: var(--color-error);
		font-weight: var(--font-weight-medium);
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

	.save-feedback {
		font-size: var(--font-size-sm);
		color: var(--color-success);
	}

	.save-feedback.error {
		color: var(--color-error);
	}
</style>
