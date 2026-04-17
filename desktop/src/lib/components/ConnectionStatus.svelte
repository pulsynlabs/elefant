<script lang="ts">
	import { connectionStore } from '$lib/stores/connection.svelte.js';

	const statusMap = {
		connected: { label: 'Connected', color: 'var(--color-success)' },
		disconnected: { label: 'Disconnected', color: 'var(--color-error)' },
		reconnecting: { label: 'Reconnecting', color: 'var(--color-warning)' },
	};

	const info = $derived(statusMap[connectionStore.status]);
</script>

<div class="connection-status" role="status" aria-live="polite" aria-label={`Daemon status: ${info.label}`}>
	<span class="status-dot" style="background-color: {info.color};" aria-hidden="true"></span>
	<span class="status-text">{info.label}</span>
</div>

<style>
	.connection-status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		transition: background-color var(--transition-base);
	}

	.status-text {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
	}
</style>
