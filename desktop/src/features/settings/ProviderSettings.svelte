<script lang="ts">
	import { configService } from '$lib/services/config-service.js';
	import type { ProviderEntry, RegistryProvider, VisualizeModelOverride } from '$lib/daemon/types.js';
	import ProviderForm from './ProviderForm.svelte';
	import ProviderQuickAdd from './ProviderQuickAdd.svelte';
	import { onMount } from 'svelte';

	let providers = $state<ProviderEntry[]>([]);
	let showForm = $state(false);
	let showQuickAdd = $state(false);
	let editingProvider = $state<ProviderEntry | undefined>(undefined);
	let selectedTemplate = $state<RegistryProvider | undefined>(undefined);
	let registryMap = $state<Map<string, RegistryProvider>>(new Map());
	let status = $state<{ type: 'success' | 'error'; message: string } | null>(null);
	let visualizeOverrideProvider = $state('');
	let visualizeOverrideModel = $state('');
	let visualizeOverrideSaved = $state<VisualizeModelOverride | null>(null);
	let visualizeOverrideSaving = $state(false);
	let visualizeOverrideError = $state('');

	/**
	 * Generic fallback icon used when a registry lookup fails.
	 * Bundled inline (NOT user input) — safe to render via {@html}.
	 */
	const FALLBACK_SVG =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';

	onMount(async () => {
		await loadProviders();
		// Load registry for icon lookup; non-critical — fail silently if it errors
		// so the rest of the UI keeps working without icons.
		try {
			const registry = await configService.fetchProviderRegistry();
			registryMap = new Map(registry.map((p) => [p.id.toLowerCase(), p]));
		} catch {
			// Icons won't show but provider CRUD still works.
		}
	});

	async function loadProviders(): Promise<void> {
		const config = await configService.readConfig();
		providers = config?.providers ?? [];
		visualizeOverrideSaved = config?.visualizeModelOverride ?? null;
		visualizeOverrideProvider = visualizeOverrideSaved?.provider ?? '';
		visualizeOverrideModel = visualizeOverrideSaved?.model ?? '';
	}

	function setStatus(type: 'success' | 'error', message: string): void {
		status = { type, message };
		setTimeout(() => {
			status = null;
		}, 3000);
	}

	async function handleSave(provider: ProviderEntry): Promise<void> {
		try {
			if (editingProvider) {
				await configService.updateProvider(editingProvider.name, provider);
				setStatus('success', 'Provider updated');
			} else {
				await configService.addProvider(provider);
				setStatus('success', 'Provider added');
			}
			await loadProviders();
			showForm = false;
			editingProvider = undefined;
			selectedTemplate = undefined;
		} catch (error) {
			setStatus('error', error instanceof Error ? error.message : 'Failed to save provider');
		}
	}

	async function handleDelete(name: string): Promise<void> {
		try {
			await configService.deleteProvider(name);
			await loadProviders();
			setStatus('success', `Provider "${name}" deleted`);
		} catch (error) {
			setStatus('error', error instanceof Error ? error.message : 'Failed to delete provider');
		}
	}

	async function saveVisualizeOverride(): Promise<void> {
		const provider = visualizeOverrideProvider.trim();
		const model = visualizeOverrideModel.trim();
		visualizeOverrideError = '';

		if (!provider || !model) {
			visualizeOverrideError = 'Provider and model are required. Use Clear to restore the default route.';
			return;
		}

		visualizeOverrideSaving = true;
		try {
			const nextOverride = { provider, model };
			await configService.setVisualizeModelOverride(nextOverride);
			visualizeOverrideSaved = nextOverride;
			visualizeOverrideProvider = provider;
			visualizeOverrideModel = model;
			setStatus('success', 'Visualization override saved');
		} catch (error) {
			setStatus('error', error instanceof Error ? error.message : 'Failed to save visualization override');
		} finally {
			visualizeOverrideSaving = false;
		}
	}

	async function clearVisualizeOverride(): Promise<void> {
		visualizeOverrideError = '';
		visualizeOverrideSaving = true;
		try {
			await configService.setVisualizeModelOverride(null);
			visualizeOverrideSaved = null;
			visualizeOverrideProvider = '';
			visualizeOverrideModel = '';
			setStatus('success', 'Visualization override cleared');
		} catch (error) {
			setStatus('error', error instanceof Error ? error.message : 'Failed to clear visualization override');
		} finally {
			visualizeOverrideSaving = false;
		}
	}

	function handleEdit(provider: ProviderEntry): void {
		editingProvider = provider;
		selectedTemplate = undefined;
		showQuickAdd = false;
		showForm = true;
	}

	function handleCancelForm(): void {
		showForm = false;
		editingProvider = undefined;
		selectedTemplate = undefined;
	}

	function handleQuickAddToggle(): void {
		showQuickAdd = !showQuickAdd;
		showForm = false;
		editingProvider = undefined;
		selectedTemplate = undefined;
	}

	function handleManualAddToggle(): void {
		// Toggle manual form; clear quick-add and template state.
		const willShow = !(showForm && !editingProvider);
		showForm = willShow;
		showQuickAdd = false;
		editingProvider = undefined;
		selectedTemplate = undefined;
	}

	function handleQuickAddSelect(provider: RegistryProvider): void {
		selectedTemplate = provider;
		showQuickAdd = false;
		editingProvider = undefined;
		showForm = true;
	}

	function lookupIcon(providerName: string): string {
		return registryMap.get(providerName.toLowerCase())?.iconSvg || '';
	}
</script>

<div class="provider-settings">
	<div class="section-header">
		<h3 class="section-heading">Providers</h3>
		<div class="header-actions">
			<button class="btn-quick-add" type="button" onclick={handleQuickAddToggle}>
				{showQuickAdd ? 'Cancel' : '✦ From Registry'}
			</button>
			<button class="btn-add" type="button" onclick={handleManualAddToggle}>
				{showForm && !editingProvider && !selectedTemplate ? 'Cancel' : '+ Add Provider'}
			</button>
		</div>
	</div>

	{#if status}
		<div class="status-message" class:error={status.type === 'error'} role="status">
			{status.message}
		</div>
	{/if}

	<section class="override-card" aria-labelledby="visualize-override-heading">
		<div class="override-header">
			<div>
				<h4 id="visualize-override-heading" class="override-heading">Visualization Model Override</h4>
				<p class="override-description">
					Route future visualization structuring through a cheaper or faster provider/model.
				</p>
			</div>
			<span class="override-badge">{visualizeOverrideSaved ? 'Override on' : 'Default route'}</span>
		</div>

		<div class="override-grid">
			<label class="field-group" for="visualize-provider">
				<span class="field-label">Provider</span>
				<input
					id="visualize-provider"
					class="field-input"
					type="text"
					bind:value={visualizeOverrideProvider}
					placeholder="openai-compatible"
				/>
			</label>

			<label class="field-group" for="visualize-model">
				<span class="field-label">Model</span>
				<input
					id="visualize-model"
					class="field-input"
					type="text"
					bind:value={visualizeOverrideModel}
					placeholder="fast-viz-model"
				/>
			</label>
		</div>

		{#if visualizeOverrideError}
			<p class="field-error">{visualizeOverrideError}</p>
		{/if}

		<div class="override-actions">
			<button
				class="btn-save-override"
				type="button"
				onclick={saveVisualizeOverride}
				disabled={visualizeOverrideSaving}
			>
				{visualizeOverrideSaving ? 'Saving...' : 'Save Override'}
			</button>
			<button
				class="btn-clear-override"
				type="button"
				onclick={clearVisualizeOverride}
				disabled={visualizeOverrideSaving || !visualizeOverrideSaved}
			>
				Clear
			</button>
		</div>
	</section>

	{#if showQuickAdd}
		<ProviderQuickAdd
			onSelect={handleQuickAddSelect}
		/>
	{/if}

	{#if showForm}
		<ProviderForm
			provider={editingProvider}
			template={editingProvider ? undefined : selectedTemplate}
			mode={selectedTemplate && !editingProvider ? 'quick-add' : 'manual'}
			onSave={handleSave}
			onCancel={handleCancelForm}
		/>
	{/if}

	{#if providers.length === 0 && !showForm && !showQuickAdd}
		<div class="empty-providers">
			<p class="empty-text">No providers configured.</p>
			<p class="empty-hint">Add an OpenAI-compatible or Anthropic provider to get started.</p>
		</div>
	{:else if providers.length > 0}
		<ul class="provider-list" role="list">
			{#each providers as provider (provider.name)}
				{@const iconSvg = lookupIcon(provider.name)}
				<li class="provider-item">
					<div class="provider-info">
						<span
							class="provider-icon"
							class:provider-icon-fallback={!iconSvg}
							aria-hidden="true"
						>
							{@html iconSvg || FALLBACK_SVG}
						</span>
						<span class="provider-name">{provider.name}</span>
						<span
							class="provider-badge"
							class:openai={provider.format === 'openai'}
							class:anthropic={provider.format === 'anthropic'}
							class:anthropic-compatible={provider.format === 'anthropic-compatible'}
						>
							{provider.format === 'openai'
								? 'OpenAI'
								: provider.format === 'anthropic'
									? 'Anthropic'
									: 'Anthropic-compat'}
						</span>
					</div>
					<div class="provider-details">
						<span class="provider-model">{provider.model}</span>
						<span class="provider-url">{provider.baseURL}</span>
					</div>
					<div class="provider-actions">
						<button
							class="btn-action"
							onclick={() => handleEdit(provider)}
							aria-label={`Edit ${provider.name}`}
						>
							Edit
						</button>
						<button
							class="btn-action danger"
							onclick={() => handleDelete(provider.name)}
							aria-label={`Delete ${provider.name}`}
						>
							Delete
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.provider-settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 640px;
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
		align-items: center;
		gap: var(--space-2);
	}

	.btn-add {
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

	.btn-add:hover {
		background-color: var(--color-primary-hover);
	}

	.btn-quick-add {
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

	.btn-quick-add:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-quick-add:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
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

	.override-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.override-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.override-heading {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.override-description {
		margin-top: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.override-badge {
		flex-shrink: 0;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		background-color: color-mix(in oklch, var(--color-primary) 12%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-primary) 24%, transparent);
		color: var(--color-primary);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
	}

	.override-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}

	.field-group {
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

	.field-error {
		font-size: var(--font-size-sm);
		color: var(--color-error);
	}

	.override-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.btn-save-override,
	.btn-clear-override {
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast),
			opacity var(--transition-fast);
	}

	.btn-save-override {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
	}

	.btn-save-override:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
	}

	.btn-clear-override {
		background: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.btn-clear-override:hover:not(:disabled) {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-save-override:disabled,
	.btn-clear-override:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.empty-providers {
		padding: var(--space-8) var(--space-5);
		text-align: center;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}

	.empty-text {
		color: var(--color-text-secondary);
		font-size: var(--font-size-md);
		margin-bottom: var(--space-2);
	}

	.empty-hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.provider-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.provider-item {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		transition: border-color var(--transition-fast);
	}

	.provider-item:hover {
		border-color: var(--color-border-strong);
	}

	.provider-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 200px;
	}

	.provider-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: var(--color-text-primary);
	}

	.provider-icon :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

	.provider-icon-fallback {
		color: var(--color-text-muted);
	}

	.provider-name {
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		font-size: var(--font-size-md);
	}

	.provider-badge {
		font-size: var(--font-size-xs);
		padding: 2px 6px;
		border-radius: var(--radius-full);
		font-weight: var(--font-weight-medium);
		white-space: nowrap;
	}

	.provider-badge.openai {
		background-color: color-mix(in oklch, var(--color-info) 12%, transparent);
		color: var(--color-info);
		border: 1px solid color-mix(in oklch, var(--color-info) 25%, transparent);
	}

	.provider-badge.anthropic {
		background-color: color-mix(in oklch, var(--color-warning) 12%, transparent);
		color: var(--color-warning);
		border: 1px solid color-mix(in oklch, var(--color-warning) 25%, transparent);
	}

	.provider-badge.anthropic-compatible {
		background-color: color-mix(in oklch, var(--color-primary) 12%, transparent);
		color: var(--color-primary);
		border: 1px solid color-mix(in oklch, var(--color-primary) 25%, transparent);
	}

	.provider-details {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.provider-model {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
	}

	.provider-url {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.provider-actions {
		display: flex;
		gap: var(--space-2);
		flex-shrink: 0;
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

	@media (max-width: 640px) {
		.override-header,
		.override-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.override-grid {
			grid-template-columns: 1fr;
		}

		.btn-save-override,
		.btn-clear-override {
			min-height: 44px;
		}
	}
</style>
