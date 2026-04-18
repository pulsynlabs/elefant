<script lang="ts">
	import { connectionStore } from '$lib/stores/connection.svelte.js';
	import { configService } from '$lib/services/config-service.js';
	import { daemonLifecycle } from '$lib/services/daemon-lifecycle.js';
	import { onMount } from 'svelte';

	type Step = 'welcome' | 'provider' | 'starting';

	type Props = { onComplete?: () => Promise<void> };
	let { onComplete }: Props = $props();

	let step = $state<Step>('welcome');

	// Provider form state
	let name = $state('my-provider');
	let format = $state<'openai' | 'anthropic'>('anthropic');
	let baseURL = $state('https://api.anthropic.com');
	let apiKey = $state('');
	let model = $state('claude-sonnet-4-5');
	let showKey = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);

	// When format changes, fill in sensible defaults
	function onFormatChange() {
		if (format === 'anthropic') {
			baseURL = 'https://api.anthropic.com';
			model = 'claude-sonnet-4-5';
		} else {
			baseURL = 'https://api.openai.com';
			model = 'gpt-4o-mini';
		}
	}

	async function handleSaveProvider() {
		if (!apiKey.trim()) {
			error = 'API key is required.';
			return;
		}

		saving = true;
		error = null;

		try {
			await configService.addProvider({
				name: name.trim() || 'my-provider',
				baseURL: baseURL.trim(),
				apiKey: apiKey.trim(),
				model: model.trim(),
				format,
			});
			// 'created' or 'exists' — both mean we're good to proceed
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save provider.';
			saving = false;
			return;
		}
		step = 'starting';
		await waitForDaemon();
	}

	async function complete() {
		await onComplete?.();
	}

	async function waitForDaemon() {
		// Daemon is already up if it responded to the provider API — complete immediately
		await connectionStore.checkNow();
		if (connectionStore.isConnected) {
			await complete();
			return;
		}

		// Daemon not reachable — try to start it
		try {
			await daemonLifecycle.startDaemon();
		} catch {
			// Shell plugin may not work everywhere; keep polling
		}

		// Poll up to 15s
		for (let i = 0; i < 15; i++) {
			await new Promise<void>((r) => setTimeout(r, 1000));
			await connectionStore.checkNow();
			if (connectionStore.isConnected) {
				await complete();
				return;
			}
		}

		// Timed out — complete anyway, user can configure manually
		await complete();
	}

	onMount(async () => {
		// If daemon is already up with a real provider, skip onboarding
		const config = await configService.readConfig();
		if (config !== null) {
			const hasRealProvider = config.providers.some((p) => p.apiKey !== '');
			if (hasRealProvider) {
				await complete();
			}
		}
	});
</script>

<div class="onboarding">
	{#if step === 'welcome'}
		<div class="step">
			<div class="brand-mark" aria-hidden="true">E</div>
			<h1 class="heading">Welcome to Elefant</h1>
			<p class="subheading">A local AI coding agent that runs on your machine.</p>
			<p class="body">
				To get started, you need an API key from Anthropic or an OpenAI-compatible provider.
				This takes about 30 seconds.
			</p>
			<button class="btn-primary" onclick={() => (step = 'provider')}>
				Get started →
			</button>
		</div>
	{:else if step === 'provider'}
		<div class="step step-form">
			<h2 class="heading">Add your first provider</h2>
			<p class="subheading">
				Your API key is stored locally in <code>~/.config/elefant/elefant.config.json</code> — it
				never leaves your machine.
			</p>

			<div class="form">
				<!-- Format -->
				<div class="field">
					<label class="label" for="ob-format">Provider type</label>
					<div class="format-pills">
						<button
							class="pill"
							class:active={format === 'anthropic'}
							onclick={() => { format = 'anthropic'; onFormatChange(); }}
						>
							Anthropic
						</button>
						<button
							class="pill"
							class:active={format === 'openai'}
							onclick={() => { format = 'openai'; onFormatChange(); }}
						>
							OpenAI-compatible
						</button>
					</div>
				</div>

				<!-- API Key -->
				<div class="field">
					<label class="label" for="ob-apikey">API Key</label>
					<div class="key-row">
						<input
							id="ob-apikey"
							type={showKey ? 'text' : 'password'}
							class="input"
							bind:value={apiKey}
							placeholder={format === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
							autocomplete="off"
							aria-required="true"
						/>
						<button
							class="btn-ghost"
							type="button"
							onclick={() => (showKey = !showKey)}
							aria-label={showKey ? 'Hide key' : 'Show key'}
						>{showKey ? '🙈' : '👁'}</button>
					</div>
					{#if format === 'anthropic'}
						<span class="hint">
							Get one at
							<a href="https://console.anthropic.com/keys" target="_blank" rel="noopener noreferrer"
								>console.anthropic.com</a
							>
						</span>
					{:else}
						<span class="hint">Enter the API key for your OpenAI-compatible endpoint.</span>
					{/if}
				</div>

				<!-- Model -->
				<div class="field">
					<label class="label" for="ob-model">Model</label>
					<input
						id="ob-model"
						type="text"
						class="input"
						bind:value={model}
						placeholder="claude-sonnet-4-5"
					/>
				</div>

				<!-- Base URL (collapsed by default for Anthropic) -->
				{#if format === 'openai'}
					<div class="field">
						<label class="label" for="ob-baseurl">Base URL</label>
						<input
							id="ob-baseurl"
							type="url"
							class="input"
							bind:value={baseURL}
							placeholder="https://api.openai.com"
						/>
					</div>
				{/if}

				{#if error}
					<div class="error-msg" role="alert">{error}</div>
				{/if}

				<div class="form-actions">
					<button class="btn-primary" onclick={handleSaveProvider} disabled={saving}>
						{saving ? 'Saving...' : 'Save & start daemon'}
					</button>
					<button class="btn-ghost-link" onclick={complete}>
						Set up manually in Settings
					</button>
				</div>
			</div>
		</div>
	{:else if step === 'starting'}
		<div class="step">
			<div class="spinner" aria-hidden="true"></div>
			<h2 class="heading">Starting daemon…</h2>
			<p class="body">
				The daemon is picking up your configuration. This usually takes a few seconds.
			</p>
		</div>
	{/if}
</div>

<style>
	.onboarding {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: var(--space-6);
		background-color: var(--color-bg);
	}

	.step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-5);
		max-width: 480px;
		width: 100%;
		text-align: center;
	}

	.step-form {
		align-items: flex-start;
		text-align: left;
	}

	.brand-mark {
		width: 72px;
		height: 72px;
		border-radius: var(--radius-xl);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 40px;
		font-weight: var(--font-weight-bold);
		font-family: var(--font-mono);
	}

	.heading {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-bold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-tight);
		line-height: 1.1;
	}

	.subheading {
		font-size: var(--font-size-md);
		color: var(--color-text-secondary);
	}

	.body {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		line-height: var(--line-height-relaxed);
		max-width: 380px;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: 100%;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
	}

	.format-pills {
		display: flex;
		gap: var(--space-2);
	}

	.pill {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.pill.active {
		border-color: var(--color-primary);
		background-color: var(--color-primary-subtle);
		color: var(--color-primary);
		font-weight: var(--font-weight-medium);
	}

	.input {
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

	.input:focus {
		border-color: var(--color-primary);
	}

	.key-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.key-row .input {
		flex: 1;
	}

	.hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
	}

	.hint a {
		color: var(--color-primary);
		text-decoration: none;
	}

	.hint a:hover {
		text-decoration: underline;
	}

	.error-msg {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-error) 25%, transparent);
		color: var(--color-error);
		font-size: var(--font-size-sm);
	}

	.form-actions {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding-top: var(--space-2);
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-6);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition: background-color var(--transition-fast), opacity var(--transition-fast);
	}

	.btn-primary:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-ghost {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 14px;
		transition: color var(--transition-fast), border-color var(--transition-fast);
		flex-shrink: 0;
	}

	.btn-ghost:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-ghost-link {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		text-decoration: underline;
		padding: 0;
	}

	.btn-ghost-link:hover {
		color: var(--color-text-secondary);
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background-color: var(--color-surface-elevated);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
	}
</style>
