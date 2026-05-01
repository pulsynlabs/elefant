<script lang="ts">
	import type { RegistryProvider } from '$lib/daemon/types.js';
	import { configService } from '$lib/services/config-service.js';
	import { onMount } from 'svelte';

	type Props = {
		onSelect: (provider: RegistryProvider) => void;
	};

	let { onSelect }: Props = $props();

	let providers = $state<RegistryProvider[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	/**
	 * Generic fallback icon used when a registry entry has no inline SVG.
	 * Bundled inline (NOT user input) — safe to render via {@html}.
	 */
	const FALLBACK_SVG =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>';

	onMount(async () => {
		try {
			providers = await configService.fetchProviderRegistry();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load providers';
		} finally {
			loading = false;
		}
	});

	function handleSelect(provider: RegistryProvider): void {
		onSelect(provider);
	}

	function handleKeydown(event: KeyboardEvent, provider: RegistryProvider): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSelect(provider);
		}
	}
</script>

<section class="quick-add" aria-labelledby="quick-add-title">
	<header class="quick-add-header">
		<div class="header-text">
			<h4 id="quick-add-title" class="title">Quick Add Provider</h4>
			<p class="subtitle">Choose a provider to pre-fill base URL and format.</p>
		</div>
	</header>

	{#if loading}
		<div class="state-panel" role="status" aria-live="polite">
			<div class="spinner" aria-hidden="true"></div>
			<p class="state-text">Loading providers…</p>
		</div>
	{:else if error}
		<div class="state-panel error" role="alert">
			<p class="state-text">Couldn't load the provider registry.</p>
			<p class="state-hint">{error}</p>
		</div>
	{:else if providers.length === 0}
		<div class="state-panel">
			<p class="state-text">No providers available.</p>
			<p class="state-hint">The registry is empty — add a provider manually instead.</p>
		</div>
	{:else}
		<ul class="provider-grid" role="list">
			{#each providers as provider (provider.id)}
				<li class="grid-item">
					<button
						type="button"
						class="provider-tile"
						onclick={() => handleSelect(provider)}
						onkeydown={(e) => handleKeydown(e, provider)}
						aria-label={`Select ${provider.name}`}
					>
						<span class="tile-icon" aria-hidden="true">
							{@html provider.iconSvg || FALLBACK_SVG}
						</span>
						<span class="tile-name">{provider.name}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.quick-add {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-5);
	}

	.quick-add-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.header-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.subtitle {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	.state-panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-8) var(--space-5);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		text-align: center;
	}

	.state-panel.error {
		border-color: var(--color-error);
		background-color: color-mix(in oklch, var(--color-error) 6%, transparent);
	}

	.state-text {
		color: var(--color-text-secondary);
		font-size: var(--font-size-md);
	}

	.state-hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2s;
		}
	}

	.provider-grid {
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: var(--space-3);
		padding: 0;
		margin: 0;
	}

	.grid-item {
		display: flex;
	}

	.provider-tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 96px;
		padding: var(--space-4) var(--space-3);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-primary);
		cursor: pointer;
		font-family: var(--font-sans);
		text-align: center;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			transform var(--transition-fast);
	}

	.provider-tile:hover {
		border-color: var(--color-border-strong);
		background-color: var(--color-surface-elevated);
	}

	.provider-tile:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		border-color: var(--color-primary);
	}

	.provider-tile:active {
		transform: translateY(1px);
	}

	@media (prefers-reduced-motion: reduce) {
		.provider-tile {
			transition: none;
		}
		.provider-tile:active {
			transform: none;
		}
	}

	.tile-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		color: var(--color-text-primary);
	}

	.tile-icon :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

	.tile-name {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
		line-height: var(--leading-tight, 1.25);
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		word-break: break-word;
	}
</style>
