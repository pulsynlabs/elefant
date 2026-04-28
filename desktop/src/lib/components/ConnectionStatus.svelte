<script lang="ts">
	import { connectionStore } from '$lib/stores/connection.svelte.js';
	import StatusDot from '$lib/components/ui/status-dot/StatusDot.svelte';
	import DaemonPopover from '$lib/components/DaemonPopover.svelte';

	const statusMap: Record<string, { label: string; dotStatus: 'connected' | 'disconnected' | 'warning' }> = {
		connected:     { label: 'Connected',    dotStatus: 'connected'    },
		disconnected:  { label: 'Disconnected', dotStatus: 'disconnected' },
		reconnecting:  { label: 'Reconnecting', dotStatus: 'warning'      },
	};

	const info = $derived(statusMap[connectionStore.status]);

	let popoverOpen = $state(false);
	let triggerEl = $state<HTMLButtonElement | null>(null);

	function togglePopover(): void {
		popoverOpen = !popoverOpen;
	}
</script>

<button
	bind:this={triggerEl}
	class="connection-btn"
	type="button"
	onclick={togglePopover}
	aria-label={`Daemon status: ${info.label}. Click to manage daemon.`}
	aria-expanded={popoverOpen}
	aria-haspopup="dialog"
>
	<StatusDot
		status={info.dotStatus}
		pulse={connectionStore.status === 'reconnecting'}
		size="sm"
	/>
	<span class="status-text mono-label">{info.label}</span>
</button>

<DaemonPopover
	open={popoverOpen}
	onClose={() => { popoverOpen = false; }}
	anchorEl={triggerEl}
/>

<style>
	.connection-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-md);
		transition:
			color var(--duration-fast) var(--ease-out-expo),
			background-color var(--duration-fast) var(--ease-out-expo);
	}

	.connection-btn:hover {
		color: var(--color-text-secondary);
		background-color: var(--color-surface-hover);
	}

	.connection-btn:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.status-text {
		transition: color var(--transition-base);
	}
</style>
