<script lang="ts">
	import type { McpServerWithStatus } from '$lib/daemon/types.js';

	type Status = McpServerWithStatus['status'];

	type Props = {
		status: Status;
	};

	let { status }: Props = $props();

	const LABEL: Record<Status, string> = {
		connecting: 'Connecting',
		connected: 'Connected',
		disabled: 'Disabled',
		failed: 'Failed',
	};
</script>

<span class="badge" class:connecting={status === 'connecting'} class:connected={status === 'connected'} class:disabled={status === 'disabled'} class:failed={status === 'failed'}>
	<span class="dot" aria-hidden="true"></span>
	<span class="label">{LABEL[status]}</span>
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		border: 1px solid transparent;
		white-space: nowrap;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
		background-color: currentColor;
	}

	.badge.connected {
		color: var(--color-success);
		background-color: color-mix(in oklch, var(--color-success) 12%, transparent);
		border-color: color-mix(in oklch, var(--color-success) 30%, transparent);
	}

	.badge.connecting {
		color: var(--color-warning);
		background-color: color-mix(in oklch, var(--color-warning) 12%, transparent);
		border-color: color-mix(in oklch, var(--color-warning) 30%, transparent);
	}

	.badge.connecting .dot {
		animation: pulse 1.4s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.45;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.badge.connecting .dot {
			animation: none;
		}
	}

	.badge.failed {
		color: var(--color-error);
		background-color: color-mix(in oklch, var(--color-error) 12%, transparent);
		border-color: color-mix(in oklch, var(--color-error) 30%, transparent);
	}

	.badge.disabled {
		color: var(--color-text-muted);
		background-color: color-mix(in oklch, var(--color-text-muted) 12%, transparent);
		border-color: color-mix(in oklch, var(--color-text-muted) 30%, transparent);
	}
</style>
