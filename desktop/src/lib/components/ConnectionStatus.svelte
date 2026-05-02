<script lang="ts">
	import { connectionStore } from '$lib/stores/connection.svelte.js';
	import { settingsStore } from '$lib/stores/settings.svelte.js';
	import StatusDot from '$lib/components/ui/status-dot/StatusDot.svelte';
	import DaemonPopover from '$lib/components/DaemonPopover.svelte';

	const statusMap: Record<string, { label: string; dotStatus: 'connected' | 'disconnected' | 'warning' }> = {
		connected:     { label: 'Connected',    dotStatus: 'connected'    },
		disconnected:  { label: 'Disconnected', dotStatus: 'disconnected' },
		reconnecting:  { label: 'Reconnecting', dotStatus: 'warning'      },
	};

	const info = $derived(statusMap[connectionStore.status]);
	const activeServer = $derived(settingsStore.activeServer);
	const serverName = $derived(activeServer?.displayName ?? 'No Server');

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
	aria-label={`Active server: ${serverName}. Status: ${info.label}. Click to switch servers.`}
	aria-expanded={popoverOpen}
	aria-haspopup="dialog"
>
	<StatusDot
		status={info.dotStatus}
		pulse={connectionStore.status === 'reconnecting'}
		size="sm"
	/>
	<span class="server-name" title={serverName}>{serverName}</span>
	<span class="separator" aria-hidden="true">—</span>
	<span class="status-text mono-label">{info.label}</span>
</button>

<DaemonPopover
	open={popoverOpen}
	onClose={() => { popoverOpen = false; }}
	anchorEl={triggerEl}
/>

<style>
	.connection-btn {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		max-width: 280px;
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

	/* Server name — truncates with ellipsis. Stays on the same line as the dot. */
	.server-name {
		display: inline-block;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
		transition: color var(--transition-base);
		min-width: 0;
	}

	.separator {
		color: var(--color-text-disabled);
		font-size: var(--font-size-sm);
		user-select: none;
	}

	.status-text {
		transition: color var(--transition-base);
	}

	/* Wrap point: at very narrow widths, the status label may break onto a new
	   line below the server name, but the server name itself never wraps. */

	/* ── Mobile touch targets (≥44px) ─────────────────────────────── */
	@media (max-width: 640px) {
		.connection-btn {
			min-height: 44px;
			max-width: 60vw;
		}

		.server-name {
			max-width: 96px;
		}
	}
</style>
