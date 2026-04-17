<script lang="ts">
	import { chatStore } from './chat.svelte.js';
</script>

<div class="provider-selector">
	{#if chatStore.availableProviders.length > 0}
		<select
			class="provider-select"
			value={chatStore.selectedProvider ?? chatStore.defaultProvider ?? chatStore.availableProviders[0]}
			onchange={(e) => chatStore.setProvider((e.currentTarget as HTMLSelectElement).value)}
			aria-label="Select provider"
		>
			{#each chatStore.availableProviders as provider}
				<option value={provider}>{provider}</option>
			{/each}
		</select>
	{:else}
		<span class="no-providers">No providers configured</span>
	{/if}
</div>

<style>
	.provider-selector {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.provider-select {
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		outline: none;
		transition: border-color var(--transition-fast);
		min-width: 140px;
	}

	.provider-select:focus {
		border-color: var(--color-primary);
	}

	.no-providers {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
