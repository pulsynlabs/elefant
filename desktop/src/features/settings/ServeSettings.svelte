<script lang="ts">
	import { onMount } from 'svelte';
	import NumberInput from '$lib/components/ui/NumberInput.svelte';
	import { HugeiconsIcon, WarningIcon } from '$lib/icons/index.js';
	import type {
		BindMode,
		ServeStatusData,
		AuthStatusData,
		TailscaleData,
	} from './serve-settings-state.js';
	import {
		deriveServeStatusLabel,
		deriveBindModeWarning,
	} from './serve-settings-state.js';

	// Server-reported state
	let serveStatus = $state<ServeStatusData | null>(null);
	let authStatus = $state<AuthStatusData | null>(null);
	let tailscale = $state<TailscaleData | null>(null);

	// Local UI state
	let selectedBindMode = $state<BindMode>('localhost');
	let port = $state(3000);
	let isLoading = $state(true);
	let actionError = $state<string | null>(null);
	let actionSuccess = $state<string | null>(null);

	// Auth form state
	let showAuthForm = $state(false);
	let authUsername = $state('');
	let authPassword = $state('');
	let isSubmittingAuth = $state(false);

	const statusLabel = $derived(deriveServeStatusLabel(serveStatus));
	const bindWarning = $derived(
		deriveBindModeWarning(selectedBindMode, authStatus?.configured ?? false),
	);

	const statusColor = $derived(
		isLoading
			? 'var(--color-text-disabled)'
			: serveStatus?.running
				? 'var(--color-success)'
				: 'var(--color-text-disabled)',
	);

	onMount(async () => {
		await loadAll();
	});

	async function loadAll(): Promise<void> {
		isLoading = true;
		try {
			const [statusRes, authRes, tailscaleRes] = await Promise.all([
				fetch('/api/serve/status'),
				fetch('/api/serve/auth/status'),
				fetch('/api/serve/tailscale'),
			]);
			serveStatus = (await statusRes.json()) as ServeStatusData;
			authStatus = (await authRes.json()) as AuthStatusData;
			tailscale = (await tailscaleRes.json()) as TailscaleData;
		} catch {
			actionError = 'Failed to load serve settings.';
		} finally {
			isLoading = false;
		}
	}

	function handleStartStopUnsupported(): void {
		actionError = null;
		actionSuccess =
			'Coming soon: start/stop from UI. Use `elefant serve` from the terminal.';
	}

	async function handleSetAuth(): Promise<void> {
		const trimmedUser = authUsername.trim();
		if (!trimmedUser || !authPassword.trim()) {
			actionError = 'Username and password are required.';
			return;
		}
		isSubmittingAuth = true;
		actionError = null;
		actionSuccess = null;
		try {
			const res = await fetch('/api/serve/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: trimmedUser, password: authPassword }),
			});
			const data = (await res.json()) as { ok: boolean; error?: string };
			if (data.ok) {
				actionSuccess = `Credentials set for user: ${trimmedUser}`;
				authUsername = '';
				authPassword = '';
				showAuthForm = false;
				await loadAll();
			} else {
				actionError = data.error ?? 'Failed to set credentials.';
			}
		} catch {
			actionError = 'Failed to set credentials.';
		} finally {
			isSubmittingAuth = false;
		}
	}

	function cancelAuthForm(): void {
		showAuthForm = false;
		authUsername = '';
		authPassword = '';
		actionError = null;
	}

	async function handleClearAuth(): Promise<void> {
		actionError = null;
		actionSuccess = null;
		try {
			await fetch('/api/serve/auth', { method: 'DELETE' });
			actionSuccess = 'Auth credentials cleared.';
			await loadAll();
		} catch {
			actionError = 'Failed to clear credentials.';
		}
	}

	function selectBindMode(mode: BindMode): void {
		selectedBindMode = mode;
	}
</script>

<div class="serve-section">
	<h3 class="section-heading">Browser Serve</h3>
	<p class="section-desc">
		Serve the desktop UI in a browser without Tauri.
	</p>

	<!-- Status card -->
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
					onclick={handleStartStopUnsupported}
					disabled
					aria-label="Start serve (coming soon)"
				>
					Start
				</button>
				<button
					class="btn-control stop"
					onclick={handleStartStopUnsupported}
					disabled
					aria-label="Stop serve (coming soon)"
				>
					Stop
				</button>
			</div>
		</div>

		<div class="port-row">
			<label class="field-label" for="serve-port">Port</label>
			<NumberInput id="serve-port" bind:value={port} min={1} max={65535} />
		</div>

		<p class="hint-text">
			Coming soon: start/stop from UI. Use <code>elefant serve</code> from the
			terminal.
		</p>
	</div>

	<!-- Binding mode card -->
	<div class="bind-card">
		<h4 class="card-heading">Binding mode</h4>
		<p class="card-desc">Where the serve listener accepts connections from.</p>

		<div class="radio-group" role="radiogroup" aria-label="Binding mode">
			<label class="radio-option">
				<input
					type="radio"
					name="bind-mode"
					value="localhost"
					checked={selectedBindMode === 'localhost'}
					onchange={() => selectBindMode('localhost')}
				/>
				<span class="radio-label">
					<span class="radio-title">Localhost only</span>
					<span class="radio-sub">Bind to 127.0.0.1 — only this machine can connect.</span>
				</span>
			</label>

			<label class="radio-option">
				<input
					type="radio"
					name="bind-mode"
					value="network"
					checked={selectedBindMode === 'network'}
					onchange={() => selectBindMode('network')}
				/>
				<span class="radio-label">
					<span class="radio-title">Network (all interfaces)</span>
					<span class="radio-sub">Bind to 0.0.0.0 — anyone on your LAN can reach the UI.</span>
				</span>
			</label>

			<label class="radio-option">
				<input
					type="radio"
					name="bind-mode"
					value="tailscale"
					checked={selectedBindMode === 'tailscale'}
					onchange={() => selectBindMode('tailscale')}
				/>
				<span class="radio-label">
					<span class="radio-title">Tailscale</span>
					<span class="radio-sub">Bind exclusively to your Tailscale interface.</span>
				</span>
			</label>
		</div>

		{#if bindWarning}
			<div class="warning-message" role="alert">
				<span class="warning-icon" aria-hidden="true">
					<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
				</span>
				{bindWarning}
			</div>
		{/if}

		{#if selectedBindMode === 'tailscale'}
			<div class="tailscale-info">
				{#if tailscale?.detected && tailscale.ip}
					<span class="tailscale-label">Detected Tailscale IP:</span>
					<code class="tailscale-ip">{tailscale.ip}</code>
				{:else}
					<span class="tailscale-missing">
						Not detected — is Tailscale running?
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Auth credentials card -->
	<div class="auth-card">
		<h4 class="card-heading">Auth credentials</h4>
		<p class="card-desc">
			Required when serving over the network or Tailscale.
		</p>

		<div class="auth-status-row">
			{#if authStatus?.configured}
				<span class="auth-status configured">
					Credentials configured for: <strong>{authStatus.username}</strong>
				</span>
			{:else}
				<span class="auth-status missing">No credentials configured</span>
			{/if}
			<div class="auth-buttons">
				<button
					class="btn-control stop"
					onclick={() => (showAuthForm = !showAuthForm)}
					aria-expanded={showAuthForm}
				>
					{authStatus?.configured ? 'Change credentials' : 'Set credentials'}
				</button>
				{#if authStatus?.configured}
					<button class="btn-control stop" onclick={handleClearAuth}>
						Clear
					</button>
				{/if}
			</div>
		</div>

		{#if showAuthForm}
			<div class="auth-form">
				<div class="form-group">
					<label class="field-label" for="serve-auth-user">Username</label>
					<input
						id="serve-auth-user"
						type="text"
						class="field-input"
						bind:value={authUsername}
						autocomplete="off"
					/>
				</div>
				<div class="form-group">
					<label class="field-label" for="serve-auth-pass">Password</label>
					<input
						id="serve-auth-pass"
						type="password"
						class="field-input"
						bind:value={authPassword}
						autocomplete="new-password"
					/>
				</div>
				<div class="auth-form-actions">
					<button
						class="btn-control start"
						onclick={handleSetAuth}
						disabled={isSubmittingAuth}
					>
						{isSubmittingAuth ? 'Saving...' : 'Save credentials'}
					</button>
					<button
						class="btn-control stop"
						onclick={cancelAuthForm}
						disabled={isSubmittingAuth}
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- Banners -->
	{#if actionError}
		<div class="error-message" role="alert">
			<span class="error-icon" aria-hidden="true">
				<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
			</span>
			{actionError}
		</div>
	{/if}

	{#if actionSuccess}
		<div class="info-message" role="status">
			<span aria-hidden="true">ℹ</span>
			{actionSuccess}
		</div>
	{/if}
</div>

<style>
	.serve-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 560px;
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

	.status-card,
	.bind-card,
	.auth-card {
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.card-heading {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.card-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-top: calc(-1 * var(--space-2));
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
			opacity var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast);
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
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-control:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.port-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.port-row :global(.number-input-wrapper) {
		flex: 0 0 auto;
		width: 160px;
	}

	.field-label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
	}

	.hint-text {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: var(--line-height-base);
	}

	.hint-text code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1);
		color: var(--color-text-secondary);
	}

	.radio-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.radio-option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.radio-option:hover {
		border-color: var(--color-border-strong);
	}

	.radio-option input[type='radio'] {
		margin-top: 3px;
		accent-color: var(--color-primary);
		cursor: pointer;
	}

	.radio-label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.radio-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
	}

	.radio-sub {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: var(--line-height-base);
	}

	.tailscale-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		padding: var(--space-2) var(--space-3);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.tailscale-label {
		color: var(--color-text-muted);
	}

	.tailscale-ip {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
	}

	.tailscale-missing {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.auth-status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.auth-status {
		font-size: var(--font-size-sm);
	}

	.auth-status.configured {
		color: var(--color-text-primary);
	}

	.auth-status.missing {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.auth-buttons {
		display: flex;
		gap: var(--space-2);
	}

	.auth-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
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

	.auth-form-actions {
		display: flex;
		gap: var(--space-2);
	}

	.warning-message {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--color-warning);
		padding: var(--space-2) var(--space-3);
		background-color: color-mix(in oklch, var(--color-warning) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-warning) 25%, transparent);
		border-radius: var(--radius-md);
		line-height: var(--line-height-base);
	}

	.warning-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		margin-top: 2px;
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
</style>
