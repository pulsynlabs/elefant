<script lang="ts">
	type LegacyStatus = 'connected' | 'disconnected' | 'warning' | 'error' | 'idle';
	type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';
	type Size = 'sm' | 'md' | 'lg';

	type Props = {
		/** Legacy semantic status (preserved). */
		status?: LegacyStatus;
		/** Quire tone (preferred). When supplied, takes priority over `status`. */
		tone?: Tone;
		pulse?: boolean;
		/** sm = 6px, md = 8px, lg = 10px. */
		size?: Size;
		class?: string;
	};

	let {
		status,
		tone,
		pulse = false,
		size = 'sm',
		class: className = '',
	}: Props = $props();

	// Map legacy status → tone
	const statusToTone: Record<LegacyStatus, Tone> = {
		connected: 'success',
		disconnected: 'neutral',
		warning: 'warning',
		error: 'error',
		idle: 'neutral',
	};

	const resolvedTone = $derived<Tone>(
		tone ?? (status ? statusToTone[status] : 'neutral')
	);

	const sizes: Record<Size, string> = { sm: '6px', md: '8px', lg: '10px' };
	const ariaLabel = $derived(status ?? resolvedTone);
</script>

<span
	class="status-dot tone-{resolvedTone} size-{size} {className}"
	class:pulse
	style="--dot-size: {sizes[size]};"
	aria-label={ariaLabel}
	role="status"
></span>

<style>
	.status-dot {
		display: inline-block;
		width: var(--dot-size);
		height: var(--dot-size);
		border-radius: var(--radius-full);
		flex-shrink: 0;
		vertical-align: middle;
		/* Ambient ring — re-declared per tone below. */
	}

	/* Tone fills + ambient rings — one ring colour per tone. */
	.tone-neutral {
		background: var(--text-muted);
		box-shadow: 0 0 0 3px rgba(111, 111, 142, 0.16);
	}
	.tone-primary {
		background: var(--color-primary);
		box-shadow: 0 0 0 3px rgba(64, 73, 225, 0.16);
	}
	.tone-success {
		background: var(--color-success);
		box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.16);
	}
	.tone-warning {
		background: var(--color-warning);
		box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.16);
	}
	.tone-error {
		background: var(--color-error);
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.16);
	}
	.tone-info {
		background: var(--color-info);
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
	}

	/* Pulse uses opacity + transform only — never animate box-shadow size. */
	.pulse {
		animation: status-pulse 1800ms var(--ease-out-quart) infinite;
		transform-origin: center;
	}

	@keyframes status-pulse {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.55;
			transform: scale(0.78);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse {
			animation: none;
		}
	}
</style>
