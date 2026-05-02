<script lang="ts">
	import type { ServerConfig } from '$lib/types/server.js';
	import {
		normalizeServerUrl,
		isLocalUrl,
		serverDisplayNameFallback,
	} from '$lib/daemon/server-utils.js';
	import { checkServerHealth, type HealthResult } from '$lib/daemon/health.js';

	type Props = {
		open: boolean;
		server?: ServerConfig;
		onSave: (data: Omit<ServerConfig, 'id'>) => void;
		onCancel: () => void;
	};

	let { open, server, onSave, onCancel }: Props = $props();

	const isEditMode = $derived(server !== undefined);

	// ─── Form state (reset whenever the modal opens or `server` changes) ──
	let urlInput = $state('');
	let displayNameInput = $state('');
	let usernameInput = $state('');
	let passwordInput = $state('');
	let showPassword = $state(false);
	let urlError = $state<string | null>(null);
	let saving = $state(false);

	// ─── Health preview state ─────────────────────────────────────────────
	type PreviewState =
		| { kind: 'idle' }
		| { kind: 'checking' }
		| { kind: 'ok'; latencyMs: number }
		| { kind: 'fail'; error: string };

	let preview = $state<PreviewState>({ kind: 'idle' });
	let confirmUnreachable = $state(false);
	let debounceHandle: ReturnType<typeof setTimeout> | null = null;
	let activeAbortController: AbortController | null = null;
	let lastCheckedUrl = $state<string | null>(null);

	// Reset form whenever modal opens or the target server changes.
	$effect(() => {
		if (!open) return;

		urlInput = server?.url ?? '';
		displayNameInput = server?.displayName ?? '';
		usernameInput = server?.credentials?.username ?? '';
		passwordInput = server?.credentials?.password ?? '';
		showPassword = false;
		urlError = null;
		preview = { kind: 'idle' };
		confirmUnreachable = false;
		lastCheckedUrl = null;

		// Cancel any pending debounce or in-flight check from a prior open.
		if (debounceHandle) {
			clearTimeout(debounceHandle);
			debounceHandle = null;
		}
		activeAbortController?.abort();
		activeAbortController = null;

		// In edit mode with an existing URL, kick a check immediately.
		if (server?.url) {
			void runHealthCheck(server.url, {
				username: server.credentials?.username ?? '',
				password: server.credentials?.password ?? '',
			});
		}
	});

	const placeholderName = $derived(
		urlInput.trim() ? serverDisplayNameFallback(normalizeServerUrl(urlInput)) : 'Local',
	);

	function scheduleHealthCheck(): void {
		// Any URL change invalidates a previous "unreachable, save anyway"
		// confirmation so the user explicitly opts in for the new URL.
		confirmUnreachable = false;
		urlError = null;

		const trimmed = urlInput.trim();

		if (debounceHandle) {
			clearTimeout(debounceHandle);
			debounceHandle = null;
		}
		activeAbortController?.abort();
		activeAbortController = null;

		if (!trimmed) {
			preview = { kind: 'idle' };
			lastCheckedUrl = null;
			return;
		}

		preview = { kind: 'checking' };

		debounceHandle = setTimeout(() => {
			debounceHandle = null;
			const credentials =
				usernameInput || passwordInput
					? { username: usernameInput, password: passwordInput }
					: undefined;
			void runHealthCheck(trimmed, credentials);
		}, 400);
	}

	async function runHealthCheck(
		rawUrl: string,
		credentials?: { username: string; password: string },
	): Promise<void> {
		const normalized = normalizeServerUrl(rawUrl);
		if (!normalized) {
			preview = { kind: 'idle' };
			return;
		}

		const controller = new AbortController();
		activeAbortController = controller;
		preview = { kind: 'checking' };
		lastCheckedUrl = normalized;

		try {
			const result: HealthResult = await checkServerHealth(normalized, {
				signal: controller.signal,
				credentials: credentials?.username || credentials?.password ? credentials : undefined,
			});

			if (controller.signal.aborted) return;

			// Discard stale results if the user has typed further while the
			// request was in flight.
			if (normalizeServerUrl(urlInput) !== normalized) return;

			preview = result.ok
				? { kind: 'ok', latencyMs: result.latencyMs }
				: { kind: 'fail', error: result.error };
		} catch {
			if (controller.signal.aborted) return;
			preview = { kind: 'fail', error: 'Network error' };
		} finally {
			if (activeAbortController === controller) {
				activeAbortController = null;
			}
		}
	}

	function handleUrlInput(event: Event): void {
		urlInput = (event.target as HTMLInputElement).value;
		scheduleHealthCheck();
	}

	function togglePasswordVisibility(): void {
		showPassword = !showPassword;
	}

	function handleSave(): void {
		const trimmed = urlInput.trim();
		if (!trimmed) {
			urlError = 'URL is required';
			return;
		}

		const normalized = normalizeServerUrl(trimmed);
		if (!normalized) {
			urlError = 'Enter a valid URL';
			return;
		}

		// Warn-but-allow when the live preview reports a failure.
		if (preview.kind === 'fail' && !confirmUnreachable) {
			confirmUnreachable = true;
			return;
		}

		const trimmedDisplayName = displayNameInput.trim();
		const credentials =
			usernameInput || passwordInput
				? { username: usernameInput, password: passwordInput }
				: undefined;

		const data: Omit<ServerConfig, 'id'> = {
			url: normalized,
			displayName: trimmedDisplayName || serverDisplayNameFallback(normalized),
			isLocal: isLocalUrl(normalized),
			isDefault: server?.isDefault ?? false,
			...(credentials ? { credentials } : {}),
		};

		saving = true;
		try {
			onSave(data);
		} finally {
			saving = false;
		}
	}

	function handleCancel(): void {
		if (debounceHandle) clearTimeout(debounceHandle);
		activeAbortController?.abort();
		onCancel();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			handleCancel();
		}
	}

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			handleCancel();
		}
	}

	function handleBackdropKey(event: KeyboardEvent): void {
		// Allow Enter/Space on the backdrop button to dismiss for keyboard users.
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleCancel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={handleBackdropClick}
		onkeydown={handleBackdropKey}
	>
		<div
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="add-edit-server-title"
		>
			<header class="modal-header">
				<h2 id="add-edit-server-title" class="modal-title">
					{isEditMode ? 'Edit server' : 'Add server'}
				</h2>
			</header>

			<div class="modal-body">
				<div class="field-group">
					<label class="field-label" for="server-url">
						URL <span class="field-required" aria-hidden="true">*</span>
					</label>
					<div class="url-row">
						<input
							id="server-url"
							class="field-input"
							class:has-error={urlError !== null}
							type="text"
							value={urlInput}
							oninput={handleUrlInput}
							placeholder="http://localhost:1337"
							autocomplete="url"
							spellcheck="false"
							autocapitalize="off"
						/>
						<span class="health-indicator" role="status" aria-live="polite">
							{#if preview.kind === 'checking'}
								<span class="health-dot pulsing" aria-hidden="true"></span>
								<span class="health-text">Checking…</span>
							{:else if preview.kind === 'ok'}
								<span class="health-dot ok" aria-hidden="true"></span>
								<span class="health-text">{preview.latencyMs}ms</span>
							{:else if preview.kind === 'fail'}
								<span class="health-dot fail" aria-hidden="true"></span>
								<span class="health-text">Unreachable</span>
							{/if}
						</span>
					</div>
					{#if urlError}
						<p class="field-error">{urlError}</p>
					{/if}
					{#if preview.kind === 'fail' && lastCheckedUrl}
						<p class="field-warning">
							{preview.error}
						</p>
					{/if}
				</div>

				<div class="field-group">
					<label class="field-label" for="server-name">Display name</label>
					<input
						id="server-name"
						class="field-input"
						type="text"
						bind:value={displayNameInput}
						placeholder={placeholderName}
						spellcheck="false"
					/>
					<p class="field-hint">Leave blank to use the hostname.</p>
				</div>

				<div class="field-group">
					<label class="field-label" for="server-username">Username</label>
					<input
						id="server-username"
						class="field-input"
						type="text"
						bind:value={usernameInput}
						placeholder="Optional"
						autocomplete="username"
						spellcheck="false"
						autocapitalize="off"
					/>
				</div>

				<div class="field-group">
					<label class="field-label" for="server-password">Password</label>
					<div class="password-row">
						<input
							id="server-password"
							class="field-input password-input"
							type={showPassword ? 'text' : 'password'}
							bind:value={passwordInput}
							placeholder="Optional"
							autocomplete="current-password"
							spellcheck="false"
						/>
						<button
							class="password-toggle"
							type="button"
							onclick={togglePasswordVisibility}
							aria-label={showPassword ? 'Hide password' : 'Show password'}
						>
							{showPassword ? 'Hide' : 'Show'}
						</button>
					</div>
				</div>

				{#if confirmUnreachable && preview.kind === 'fail'}
					<div class="confirm-banner" role="alert">
						<strong>Unreachable.</strong>
						Save anyway? Click {isEditMode ? 'Save' : 'Add server'} again to confirm.
					</div>
				{/if}
			</div>

			<footer class="modal-footer">
				<button
					class="btn btn-secondary"
					type="button"
					onclick={handleCancel}
					disabled={saving}
				>
					Cancel
				</button>
				<button
					class="btn btn-primary"
					type="button"
					onclick={handleSave}
					disabled={saving || !urlInput.trim()}
				>
					{isEditMode ? 'Save' : 'Add server'}
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background-color: rgba(0, 0, 0, 0.5);
		animation: fade-in var(--transition-base);
	}

	.modal {
		width: 100%;
		max-width: 480px;
		max-height: calc(100vh - var(--space-8));
		display: flex;
		flex-direction: column;
		background-color: var(--surface-plate);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xl);
		overflow: hidden;
		animation: slide-up var(--duration-base) var(--ease-out-expo);
	}

	.modal-header {
		padding: var(--space-5) var(--space-5) var(--space-3);
		border-bottom: 1px solid var(--border-hairline);
	}

	.modal-title {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: 600;
		color: var(--text-prose);
	}

	.modal-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--border-hairline);
		background-color: var(--surface-substrate);
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.field-label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-meta);
	}

	.field-required {
		color: var(--color-error);
	}

	.field-input {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background-color: var(--surface-leaf);
		color: var(--text-prose);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--font-size-sm);
		outline: none;
		transition:
			border-color var(--transition-base),
			box-shadow var(--transition-base);
	}

	.field-input:focus {
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus);
	}

	.field-input.has-error {
		border-color: var(--color-error);
	}

	.field-error {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-error);
	}

	.field-hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	.field-warning {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-warning);
	}

	.url-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.url-row .field-input {
		flex: 1;
		min-width: 0;
	}

	.health-indicator {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0 var(--space-2);
		min-height: 28px;
		font-size: var(--font-size-xs);
		font-family: var(--font-mono);
		color: var(--text-meta);
		flex-shrink: 0;
	}

	.health-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.health-dot.pulsing {
		background-color: var(--text-muted);
		animation: pulse 1.2s ease-in-out infinite;
	}

	.health-dot.ok {
		background-color: var(--color-success);
	}

	.health-dot.fail {
		background-color: var(--color-error);
	}

	.health-text {
		white-space: nowrap;
	}

	.password-row {
		display: flex;
		align-items: stretch;
		gap: var(--space-2);
	}

	.password-input {
		flex: 1;
		min-width: 0;
	}

	.password-toggle {
		padding: 0 var(--space-3);
		background-color: transparent;
		color: var(--text-meta);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--font-size-xs);
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base);
		min-width: 60px;
	}

	.password-toggle:hover,
	.password-toggle:focus-visible {
		background-color: var(--surface-hover);
		color: var(--text-prose);
		outline: none;
	}

	.confirm-banner {
		padding: var(--space-3);
		background-color: rgba(245, 158, 11, 0.10);
		border: 1px solid rgba(245, 158, 11, 0.30);
		border-radius: var(--radius-md);
		font-size: var(--font-size-xs);
		color: var(--text-prose);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
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

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		background-color: transparent;
		color: var(--text-meta);
		border: 1px solid var(--border-edge);
	}

	.btn-secondary:hover:not(:disabled),
	.btn-secondary:focus-visible:not(:disabled) {
		background-color: var(--surface-hover);
		color: var(--text-prose);
		outline: none;
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: 1px solid var(--color-primary);
	}

	.btn-primary:hover:not(:disabled),
	.btn-primary:focus-visible:not(:disabled) {
		background-color: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		outline: none;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.45;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.15);
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slide-up {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 640px) {
		.modal {
			max-width: 100%;
			max-height: calc(100vh - var(--space-4));
		}

		.btn {
			min-height: 44px;
		}

		.password-toggle {
			min-height: 44px;
		}

		.field-input {
			min-height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.modal,
		.modal-backdrop {
			animation: none;
		}

		.health-dot.pulsing {
			animation: none;
		}
	}
</style>
