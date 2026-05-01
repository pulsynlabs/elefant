<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		toolName: string;
		status: 'running' | 'success' | 'error';
		errorMessage?: string;
		subtitle?: string;
		children?: Snippet;
	};

	let { toolName, status, errorMessage, subtitle, children }: Props = $props();
</script>

<div class="tool-card-shell">
	<div class="shell-header">
		<div class="shell-header-left">
			<span class="status-indicator" class:running={status === 'running'} class:success={status === 'success'} class:error={status === 'error'} aria-hidden="true">
				{#if status === 'running'}
					<span class="pulse-dot"></span>
				{:else if status === 'success'}
					&#10003;
				{:else}
					&#10007;
				{/if}
			</span>
			<div class="shell-name-group">
				<span class="shell-tool-name">{toolName}</span>
				{#if subtitle}
					<span class="shell-subtitle">{subtitle}</span>
				{/if}
			</div>
		</div>
		<div class="shell-header-right">
			{#if status === 'error' && errorMessage}
				<span class="shell-error-message">{errorMessage}</span>
			{/if}
		</div>
	</div>

	{#if children}
		<div class="shell-body">
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.tool-card-shell {
		border: 1px solid var(--border-edge);
		border-left: 3px solid var(--color-primary);
		border-radius: var(--radius-lg);
		background-color: var(--surface-plate);
		overflow: hidden;
	}

	.shell-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		min-height: 36px;
	}

	.shell-header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.shell-header-right {
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.status-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		font-size: 12px;
		line-height: 1;
	}

	.status-indicator.running { color: var(--color-primary); }
	.status-indicator.success { color: var(--color-success); }
	.status-indicator.error { color: var(--color-error); }

	.pulse-dot {
		display: block;
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background-color: var(--color-primary);
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.4; transform: scale(0.85); }
	}

	.shell-name-group {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.shell-tool-name {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--text-prose);
		line-height: 1.3;
	}

	.shell-subtitle {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		line-height: 1.3;
	}

	.shell-error-message {
		font-size: var(--font-size-xs);
		color: var(--color-error);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		max-width: 300px;
		font-family: var(--font-sans);
	}

	.shell-body {
		border-top: 1px solid var(--border-edge);
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse-dot { animation: none; }
	}
</style>
