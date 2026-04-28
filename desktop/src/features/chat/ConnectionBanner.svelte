<script lang="ts">
	import { connectionStore } from '$lib/stores/connection.svelte.js';
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import { HugeiconsIcon, WarningIcon } from '$lib/icons/index.js';

	function goToSettings(): void {
		navigationStore.navigate('settings');
	}
</script>

{#if connectionStore.status !== 'connected'}
	<div
		class="connection-banner"
		class:disconnected={connectionStore.status === 'disconnected'}
		class:reconnecting={connectionStore.status === 'reconnecting'}
	>
		<div class="banner-content">
			<span class="banner-icon" aria-hidden="true">
				{#if connectionStore.status === 'reconnecting'}
					<span class="pulse-dot"></span>
				{:else}
					<HugeiconsIcon icon={WarningIcon} size={14} strokeWidth={1.5} />
				{/if}
			</span>
			<span class="banner-text">
				{#if connectionStore.status === 'reconnecting'}
					Reconnecting to daemon...
				{:else}
					Daemon disconnected
					{#if connectionStore.lastError}
						<span class="error-detail">({connectionStore.lastError})</span>
					{/if}
				{/if}
			</span>
		</div>
		<Button variant="ghost" size="sm" onclick={goToSettings}>Settings</Button>
	</div>
{/if}

<style>
	.connection-banner {
		position: sticky;
		top: 0;
		z-index: var(--z-sticky, 100);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-5);
		font-size: var(--font-size-xs);
		border-bottom: 1px solid transparent;
	}

	.connection-banner.disconnected {
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		border-bottom-color: color-mix(in oklch, var(--color-error) 25%, transparent);
	}

	.connection-banner.reconnecting {
		background-color: color-mix(in oklch, var(--color-warning) 8%, transparent);
		border-bottom-color: color-mix(in oklch, var(--color-warning) 25%, transparent);
	}

	.banner-content {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.banner-icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
	}

	.connection-banner.disconnected .banner-icon {
		color: var(--color-error);
	}

	.connection-banner.reconnecting .banner-icon {
		color: var(--color-warning);
	}

	.pulse-dot {
		display: block;
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background-color: var(--color-warning);
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.banner-text {
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.error-detail {
		color: var(--color-text-muted);
		margin-left: var(--space-1);
	}
</style>
