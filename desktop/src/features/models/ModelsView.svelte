<script lang="ts">
	import { configService } from '$lib/services/config-service.js';
	import type { ProviderEntry } from '$lib/daemon/types.js';
	import ProviderCard from './ProviderCard.svelte';
	import Spinner from '$lib/components/ui/spinner/Spinner.svelte';
	import EmptyState from '$lib/components/ui/empty-state/EmptyState.svelte';
	import { onMount } from 'svelte';

	let providers = $state<ProviderEntry[]>([]);
	let loading = $state(true);

	onMount(async () => {
		const config = await configService.readConfig();
		providers = config?.providers ?? [];
		loading = false;
	});
</script>

<div class="models-view">
	<div class="models-header">
		<h2 class="models-title industrial-caps">Models</h2>
		<p class="models-subtitle mono-label">Configured AI providers and their models.</p>
	</div>

	{#if loading}
		<div class="loading-state" role="status" aria-live="polite">
			<Spinner size="md" />
			<p class="loading-text">Loading providers…</p>
		</div>
	{:else if providers.length === 0}
		<EmptyState
			title="No providers configured"
			description="Add providers in Settings → Providers to see them here. Elefant supports OpenAI-compatible and Anthropic APIs."
		/>
	{:else}
		<ul class="provider-grid" role="list">
			{#each providers as provider}
				<ProviderCard {provider} />
			{/each}
		</ul>
	{/if}
</div>

<style>
	.models-view {
		position: absolute;
		inset: 0;
		overflow-y: auto;
	}

	.models-header {
		padding: var(--space-5) var(--space-6);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-surface);
		flex-shrink: 0;
	}

	.models-title {
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
	}

	.models-subtitle {
		color: var(--color-text-muted);
		margin-top: var(--space-1);
	}

	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-10) var(--space-6);
	}

	.loading-text {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.provider-grid {
		list-style: none;
		padding: var(--space-5) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		overflow-y: auto;
	}
</style>
